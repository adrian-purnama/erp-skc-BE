export function normalizeEmail(email: unknown): string | null {
    if (typeof email !== "string") {
        return null;
    }

    const value = email.trim().toLowerCase();

    if (!value || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) {
        return null;
    }

    return value;
}
