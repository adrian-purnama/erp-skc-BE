export function encodeResetToken(email: string, otp: string): string {
  return Buffer.from(JSON.stringify({ email, otp }), "utf8").toString(
    "base64url",
  );
}
