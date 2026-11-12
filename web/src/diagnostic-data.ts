import type { Selection } from "./data";

export type Driver = "order_volume" | "aov";
export type Operation = "volume_aov" | "state_orders" | "product_changes";
export type CheckRequest = Selection & { category: string; operation: Operation; state?: string };
export type Period = { gmv: number; orders: number; aov: number | null };
export type VolumeCheck = { before: Period | null; after: Period } & (
  { status: "insufficient" } |
  { status: "determined" | "mixed"; driver: Driver | null; order_effect: number; aov_effect: number; order_share: number | null }
);
export type StateCheck = {
  direction: number;
  rows: { state: string; previous_orders: number | null; current_orders: number; order_delta: number | null; gmv_delta: number | null }[];
};
export type ProductCheck = {
  gmv_delta: number | null;
  rows: {
    product: string;
    name?: string;
    previous_gmv: number | null;
    current_gmv: number;
    previous_orders: number | null;
    current_orders: number;
    gmv_delta: number | null;
  }[];
};
export type LocalCheck = (request: CheckRequest) => VolumeCheck | StateCheck | ProductCheck;
