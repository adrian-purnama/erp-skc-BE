/** QR + link printed on issued quotations for the client verification page. */
export type QuotationVerifyMark = {
  url: string;
  qrPng: Buffer;
};

export const VERIFY_NOTE =
  "Scan or open the link to view and verify this quotation online until it expires.";
