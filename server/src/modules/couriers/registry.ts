import type { CourierAdapter, CourierContext } from "./types.js";
import { mockAdapter } from "./adapters/mock.js";
import { steadfastAdapter } from "./adapters/steadfast.js";
import { pathaoAdapter } from "./adapters/pathao.js";
import { redxAdapter } from "./adapters/redx.js";
import { ecourierAdapter } from "./adapters/ecourier.js";
import { decrypt, decryptJson } from "../../lib/crypto.js";
import { notFound, unprocessable } from "../../lib/errors.js";
import { prisma } from "../../lib/prisma.js";
import type { CourierProvider } from "../../generated/prisma/client.js";

const adapters = new Map<string, CourierAdapter>();
export const registerAdapter = (a: CourierAdapter) => adapters.set(a.code, a);
registerAdapter(mockAdapter);
registerAdapter(steadfastAdapter);
registerAdapter(pathaoAdapter);
registerAdapter(redxAdapter);
registerAdapter(ecourierAdapter);
// Paperfly: no public official API documentation could be found – intentionally not implemented.

export function getAdapter(code: string): CourierAdapter | null {
  return adapters.get(code) ?? null;
}

export const listAdapters = () => [...adapters.values()];

export function contextFor(provider: CourierProvider, shipmentId?: string | null): CourierContext {
  return {
    providerId: provider.id,
    shipmentId: shipmentId ?? null,
    sandbox: provider.sandbox,
    credentials: decryptJson<Record<string, string>>(provider.credentials) ?? {},
    config: (provider.config ?? {}) as Record<string, unknown>,
    webhookSecret: provider.webhookSecret ? decrypt(provider.webhookSecret) : null,
  };
}

/** Resolve an enabled provider with an implemented adapter (explicit id or the default). */
export async function resolveProvider(providerId?: string | null) {
  const provider = providerId
    ? await prisma.courierProvider.findUnique({ where: { id: providerId } })
    : await prisma.courierProvider.findFirst({ where: { isDefault: true, isEnabled: true } });
  if (!provider) throw notFound(providerId ? "Courier provider" : "Default courier provider");
  if (!provider.isEnabled) throw unprocessable("PROVIDER_DISABLED", `${provider.name} is disabled`);
  const adapter = getAdapter(provider.code);
  if (!adapter) throw unprocessable("PROVIDER_NOT_IMPLEMENTED", `${provider.name} integration is not available`);
  return { provider, adapter };
}
