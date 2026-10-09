/** Future MAX adapter contract. Routing and renderer require separate agreement. */
import type { Version } from "./production-domain";
export type ProductionDestination = { id: string; label: string };
export type ProductionDeliveryPart = { destination: ProductionDestination; part: number; text: string };
export type ProductionDeliveryResult = { state: "sent"; messageId: string } | { state: "failed" | "unknown"; code: string };
export interface ProductionDeliveryAdapter {
  destinations(version: Readonly<Version>): Promise<ProductionDestination[]>;
  render(version: Readonly<Version>, destination: ProductionDestination): Promise<ProductionDeliveryPart[]>;
  send(part: Readonly<ProductionDeliveryPart>): Promise<ProductionDeliveryResult>;
}
