import { JAKARTA_TZ } from "../time";

/** Text formatting shared by generated documents (Indonesian locale). */

export function formatLongDate(d: Date): string {
  return new Intl.DateTimeFormat("id-ID", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: JAKARTA_TZ,
  }).format(d);
}

export function splitLines(raw: string): string[] {
  return raw
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
}

export function formatRp(amount: number): string {
  const sign = amount < 0 ? "-" : "";
  return `${sign}Rp ${new Intl.NumberFormat("id-ID", { maximumFractionDigits: 0 }).format(Math.abs(amount))}`;
}

/** Long Indonesian date for a `YYYY-MM-DD` (Jakarta) value, or "-" when missing. */
export function ymdLong(ymd: string | null): string {
  return ymd ? formatLongDate(new Date(`${ymd}T00:00:00+07:00`)) : "-";
}

// Excel / file export helpers

export function sanitizeExcelText(raw: string): string {
  const s = String(raw ?? "");
  if (/^[=+\-@]/.test(s)) return `'${s}`;
  return s;
}

export function safeFilenamePart(raw: string): string {
  return (
    String(raw ?? "")
      .trim()
      .replace(/[^\w-]+/g, "_")
      .replace(/_+/g, "_")
      .replace(/^_|_$/g, "")
      .slice(0, 60) || "Project"
  );
}

export function formatExportYmd(d = new Date()): string {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}${m}${day}`;
}

export function toRoman(n: number): string {
  if (n <= 0 || n > 3999) return String(n);
  const map: Array<[number, string]> = [
    [1000, "M"],
    [900, "CM"],
    [500, "D"],
    [400, "CD"],
    [100, "C"],
    [90, "XC"],
    [50, "L"],
    [40, "XL"],
    [10, "X"],
    [9, "IX"],
    [5, "V"],
    [4, "IV"],
    [1, "I"],
  ];
  let rest = n;
  let out = "";
  for (const [v, s] of map) {
    while (rest >= v) {
      out += s;
      rest -= v;
    }
  }
  return out;
}

export function toLetter(n: number): string {
  if (n <= 0) return String(n);
  let rest = n;
  let out = "";
  while (rest > 0) {
    rest -= 1;
    out = String.fromCharCode(65 + (rest % 26)) + out;
    rest = Math.floor(rest / 26);
  }
  return out;
}

const SATUAN = [
  "",
  "Satu",
  "Dua",
  "Tiga",
  "Empat",
  "Lima",
  "Enam",
  "Tujuh",
  "Delapan",
  "Sembilan",
  "Sepuluh",
  "Sebelas",
];

function terbilangUnderThousand(n: number): string {
  if (n < 12) return SATUAN[n] ?? "";
  if (n < 20) return `${SATUAN[n - 10]} Belas`;
  if (n < 100) {
    const tens = Math.floor(n / 10);
    const rem = n % 10;
    return `${SATUAN[tens]} Puluh${rem ? ` ${SATUAN[rem]}` : ""}`;
  }
  const hundreds = Math.floor(n / 100);
  const rem = n % 100;
  const head = hundreds === 1 ? "Seratus" : `${SATUAN[hundreds]} Ratus`;
  return rem ? `${head} ${terbilangUnderThousand(rem)}` : head;
}

/** Indonesian words for a non-negative rupiah amount (integer). */
export function terbilangRupiah(amount: number): string {
  const n = Math.round(Math.abs(amount));
  if (!Number.isFinite(n) || n === 0) return "Nol Rupiah";

  const scales: Array<[number, string, boolean]> = [
    [1_000_000_000_000, "Triliun", false],
    [1_000_000_000, "Miliar", false],
    [1_000_000, "Juta", false],
    [1_000, "Ribu", true],
  ];

  let rest = n;
  const parts: string[] = [];
  for (const [div, label, seribu] of scales) {
    if (rest < div) continue;
    const chunk = Math.floor(rest / div);
    rest %= div;
    if (seribu && chunk === 1) {
      parts.push(`Seribu`);
    } else {
      parts.push(`${terbilangUnderThousand(chunk)} ${label}`);
    }
  }
  if (rest > 0) parts.push(terbilangUnderThousand(rest));
  return `${parts.join(" ").replace(/\s+/g, " ").trim()} Rupiah`;
}
