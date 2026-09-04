import type { DashboardMoney, FormattedMoney, MoneyDto } from "@camircode/twofree-ui";

const integerPattern = /^-?(?:0|[1-9]\d*)$/;
const currencyPrefixes: Readonly<Record<string, string>> = {
  AUD: "$",
  CAD: "$",
  CNY: "¥",
  EUR: "€",
  GBP: "£",
  JPY: "¥",
  MXN: "$",
  USD: "$",
};

function groupThousands(value: string): string {
  return value.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

function numericText(dto: MoneyDto): string {
  if (!dto.currency.trim()) throw new Error("currency is required");
  if (!integerPattern.test(dto.coefficient))
    throw new Error("coefficient must be an integer string");
  if (!Number.isSafeInteger(dto.scale) || dto.scale < 0) {
    throw new Error("scale must be a non-negative safe integer");
  }

  const negative = dto.coefficient.startsWith("-");
  const digits = negative ? dto.coefficient.slice(1) : dto.coefficient;
  const padded = digits.padStart(dto.scale + 1, "0");
  const decimalIndex = padded.length - dto.scale;
  const whole = padded.slice(0, decimalIndex);
  const fraction = padded.slice(decimalIndex);
  const number = dto.scale === 0 ? groupThousands(whole) : `${groupThousands(whole)}.${fraction}`;
  const prefix = currencyPrefixes[dto.currency.toUpperCase()] ?? "";

  return `${negative ? "-" : ""}${prefix}${number}`;
}

export function formatMoneyDto(dto: MoneyDto): FormattedMoney {
  return {
    currency: dto.currency,
    text: numericText(dto),
  };
}

export function toDashboardMoney(dto: MoneyDto): DashboardMoney {
  return {
    exact: dto,
    formatted: formatMoneyDto(dto),
  };
}
