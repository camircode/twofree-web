// Builds the image, pushes it to GHCR by digest, and commits that digest to the
// GitOps repository.
//
// This pipeline never touches the cluster. Argo CD does the deploying, and the
// only thing Jenkins changes is a line in git — which is why the git log of
// camircode/gitops is the real deployment history.

pipeline {
    agent { label 'docker' }

    options {
        timestamps()
        timeout(time: 25, unit: 'MINUTES')
        disableConcurrentBuilds()
        buildDiscarder(logRotator(numToKeepStr: '30'))
    }

    environment {
        REGISTRY = 'ghcr.io'
        IMAGE    = 'ghcr.io/camircode/twofree-web'
        GITOPS   = 'git@github.com:camircode/gitops.git'
        MANIFEST = 'manifests/twofree-web/deployment.yaml'
    }

    stages {
        stage('Test') {
            steps {
                // In a container rather than on the agent, so the agent does not
                // accumulate a toolchain per language it ever built.
                //
                // The flags that are not decoration:
                //
                //   -u and HOME=/tmp, so node_modules is not left behind owned by
                //   root for cleanWs() to fail on, and corepack has somewhere to
                //   write.
                //
                //   NPM_CONFIG_USERCONFIG, because the shared packages are private
                //   on GitHub Packages and pnpm needs a token to resolve them. The
                //   file is written outside the workspace and removed in post, so
                //   it is never part of the build context or of a stash.
                //
                // The browser suites are deliberately not here: they drive a real
                // Chromium against `next dev` and belong to the quality gate in
                // the repository, not to the delivery pipeline. What this pipeline
                // has to prove about the built artefact, it proves by starting it
                // in the smoke test below.
                withCredentials([usernamePassword(
                    credentialsId: 'ghcr',
                    usernameVariable: 'GHCR_USER',
                    passwordVariable: 'GHCR_PASS',
                )]) {
                    sh '''
                        set -eu
                        umask 077
                        NPMRC="$WORKSPACE@tmp/npmrc"
                        mkdir -p "$(dirname "$NPMRC")"
                        printf '//npm.pkg.github.com/:_authToken=%s\\n' "$GHCR_PASS" > "$NPMRC"

                        docker run --rm \
                          -u "$(id -u):$(id -g)" \
                          -e HOME=/tmp -e CI=true \
                          -e NPM_CONFIG_USERCONFIG=/npmrc \
                          -v "$NPMRC":/npmrc:ro \
                          -v "$PWD":/src -w /src \
                          node:24 \
                          sh -c '
                            set -eu
                            # The directory has to exist first: corepack resolves it
                            # with realpathSync and fails with a bare ENOENT if it
                            # does not.
                            mkdir -p /tmp/bin
                            corepack enable --install-directory /tmp/bin
                            export PATH=/tmp/bin:$PATH
                            pnpm install --frozen-lockfile
                            pnpm lint
                            pnpm typecheck
                            pnpm test
                          '
                    '''
                }
            }
        }

        stage('Build and push') {
            steps {
                // Computed in Groovy, not in the shell. `${VAR:0:7}` is a bash
                // substring and Jenkins runs `sh`, which on Debian is dash: it
                // answers "Bad substitution" and nothing else.
                script {
                    env.SHORT_SHA = env.GIT_COMMIT.take(7)
                }
                withCredentials([usernamePassword(
                    credentialsId: 'ghcr',
                    usernameVariable: 'GHCR_USER',
                    passwordVariable: 'GHCR_PASS',
                )]) {
                    sh '''
                        set -eu
                        echo "$GHCR_PASS" | docker login "$REGISTRY" -u "$GHCR_USER" --password-stdin

                        docker buildx create --use --name builder 2>/dev/null || docker buildx use builder

                        # The same credential, in the shape npm wants, handed to the
                        # build as --secret rather than --build-arg. A build ARG is
                        # recorded in the image history: `docker history` prints it
                        # back to anyone who can pull the image. A secret mount is
                        # visible only during the RUN that asks for it.
                        umask 077
                        NPMRC="$WORKSPACE@tmp/npmrc"
                        mkdir -p "$(dirname "$NPMRC")"
                        printf '//npm.pkg.github.com/:_authToken=%s\\n' "$GHCR_PASS" > "$NPMRC"

                        # The tag exists so a human can find the build; the digest
                        # is what gets deployed. --metadata-file is how the digest
                        # comes back without a second registry round trip.
                        docker buildx build \
                          --push \
                          --provenance=false \
                          --secret "id=npmrc,src=$NPMRC" \
                          --tag "$IMAGE:$SHORT_SHA" \
                          --metadata-file metadata.json \
                          .
                    '''
                }
                script {
                    def meta = readJSON file: 'metadata.json'
                    env.IMAGE_DIGEST = meta['containerimage.digest']
                    echo "Pushed ${env.IMAGE}@${env.IMAGE_DIGEST}"
                }
            }
        }

        stage('Smoke test') {
            steps {
                // Start the image before committing its digest.
                //
                // This exists because of a concrete failure: a pipeline once built,
                // scanned and delivered to GitOps an image that could not run, and
                // it was found in the cluster with the pod in CrashLoopBackOff. The
                // tests cannot see that class of failure — they run against the
                // source, not against the image, and it only appears on start.
                //
                // Run with the same user and the same read-only filesystem the
                // Deployment applies, because "works as root" and "works as 10001
                // with nowhere to write" are different claims.
                //
                // By digest, not by tag: what is tested is exactly what ships.
                sh '''
                    set -eu
                    APP="smoke-app-$BUILD_NUMBER"

                    cleanup() {
                      docker logs "$APP" 2>&1 | tail -30 || true
                      docker rm -f "$APP" >/dev/null 2>&1 || true
                    }
                    trap cleanup EXIT

                    docker pull "${IMAGE}@${IMAGE_DIGEST}"

                    # API_URL points nowhere on purpose. The pages fail closed to
                    # their Spanish error state, which is exactly the path the
                    # cluster takes when the API is not up yet, and it keeps the
                    # smoke test from needing a database.
                    docker run -d --name "$APP" -p 18080:8080 \
                      --user 10001:10001 --read-only --tmpfs /tmp \
                      -e API_URL="http://127.0.0.1:1" \
                      "${IMAGE}@${IMAGE_DIGEST}"

                    probe() {
                      curl -sS -o /dev/null -w '%{http_code}' --max-time 5 "http://127.0.0.1:18080$1"
                    }

                    ok=""
                    for i in $(seq 1 45); do
                      if [ "$(probe /app/health || true)" = "200" ]; then ok=yes; break; fi
                      sleep 2
                    done
                    [ -n "$ok" ] || { echo "The image never answered on /app/health."; exit 1; }

                    # /app/health alone does not prove the basePath took: the health
                    # route is static and answers 200 from wherever it is mounted.
                    # The asset prefix inside the HTML is what proves it, and getting
                    # it wrong is the failure that ships a page with no CSS.
                    [ "$(probe /app)" = "200" ] || { echo "/app did not answer 200."; exit 1; }
                    curl -sS --max-time 10 "http://127.0.0.1:18080/app" | grep -q '/app/_next/' || {
                      echo "The HTML at /app does not reference /app/_next/: basePath did not take effect."
                      exit 1
                    }

                    echo "Smoke test passed: the image starts unprivileged and read-only, and serves under /app."
                '''
            }
        }

        stage('Scan') {
            steps {
                // After the push and before the GitOps commit, deliberately. An
                // image that fails here exists in the registry and is never
                // referenced by anything, which is harmless — whereas scanning
                // before the push would mean scanning an image built from a
                // different set of layers than the one that shipped.
                //
                // --ignore-unfixed, because failing a build over a vulnerability
                // with no fix available teaches people to ignore the scanner. The
                // exceptions live in .trivyignore.yaml, each with a reachability
                // argument and a date it stops applying.
                withCredentials([usernamePassword(
                    credentialsId: 'ghcr',
                    usernameVariable: 'GHCR_USER',
                    passwordVariable: 'GHCR_PASS',
                )]) {
                    sh '''
                        set -eu
                        docker run --rm \
                          -e TRIVY_USERNAME="$GHCR_USER" \
                          -e TRIVY_PASSWORD="$GHCR_PASS" \
                          -v "$HOME/.cache/trivy:/root/.cache/" \
                          -v "$PWD/.trivyignore.yaml:/.trivyignore.yaml:ro" \
                          aquasec/trivy:latest image \
                            --scanners vuln \
                            --severity HIGH,CRITICAL \
                            --ignore-unfixed \
                            --ignorefile /.trivyignore.yaml \
                            --exit-code 1 \
                            "${IMAGE}@${IMAGE_DIGEST}"
                    '''
                }
            }
        }

        stage('Update the desired state') {
            steps {
                sshagent(credentials: ['gitops-write']) {
                    sh '''
                        set -eu
                        rm -rf gitops
                        GIT_SSH_COMMAND="ssh -o StrictHostKeyChecking=accept-new" \
                          git clone --depth 1 "$GITOPS" gitops

                        cd gitops
                        git config user.email "jenkins@camir.tech"
                        git config user.name  "jenkins"

                        # Matches the repository rather than the old value, so the
                        # scaffold's :PLACEHOLDER, a previous digest and a
                        # hand-edited manifest are all corrected rather than one
                        # of them being silently skipped.
                        sed -i -E "s#image: ghcr\\.io/camircode/twofree-web[@:][^[:space:]]+#image: ${IMAGE}@${IMAGE_DIGEST}#" "$MANIFEST"

                        if git diff --quiet; then
                          echo "Already at ${IMAGE_DIGEST}; nothing to commit."
                          exit 0
                        fi

                        git add "$MANIFEST"
                        git commit -m "deploy(twofree-web): ${IMAGE_DIGEST}

Built from camircode/twofree-web@${GIT_COMMIT} by Jenkins build ${BUILD_NUMBER}."
                        GIT_SSH_COMMAND="ssh -o StrictHostKeyChecking=accept-new" git push origin main
                    '''
                }
            }
        }
    }

    post {
        always {
            // The npmrc holds a GHCR read token in plaintext. It lives outside the
            // workspace, so cleanWs() does not reach it, and deleting it here is
            // what keeps it from surviving on the agent until the next build.
            sh 'rm -f "$WORKSPACE@tmp/npmrc" || true'
            sh 'docker logout ghcr.io || true'
            cleanWs()
        }
    }
}
