export interface SecretStore {
  getSecret(key: string): string | undefined;
  requireSecret(key: string): string;
}

export class EnvSecretStore implements SecretStore {
  constructor(private readonly prefix = "") {}

  getSecret(key: string): string | undefined {
    const normalizedKey = this.prefix ? `${this.prefix}${key}` : key;
    const value = process.env[normalizedKey] ?? process.env[key];
    return typeof value === "string" && value.length > 0 ? value : undefined;
  }

  requireSecret(key: string): string {
    const value = this.getSecret(key);
    if (value === undefined) {
      throw new Error(`Missing required secret: ${key}`);
    }
    return value;
  }
}

export const defaultSecretStore = new EnvSecretStore();
