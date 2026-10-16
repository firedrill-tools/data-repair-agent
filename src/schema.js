import { z } from "zod";
export const identifier = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_-]{0,159}$/);
export const line = (max) =>
  z
    .string()
    .min(1)
    .max(max)
    .refine(
      (v) => !!v.trim() && v.isWellFormed() && !/[\x00-\x1f\x7f]/.test(v),
    );
export const revision = z.number().int().min(1).max(Number.MAX_SAFE_INTEGER);
export const email = z
  .string()
  .max(254)
  .regex(
    /^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)*\.example$/,
  )
  .refine((v) => {
    const local = v.split("@")[0];
    return (
      local.length <= 64 &&
      !local.startsWith(".") &&
      !local.endsWith(".") &&
      !local.includes("..")
    );
  });
// Explicit fictional typo namespace for repairable source, never a delivery target.
export const contactEmail = z
  .string()
  .refine(
    (v) =>
      email.safeParse(v).success ||
      (v.endsWith(".exmaple") &&
        email.safeParse(v.slice(0, -8) + ".example").success),
    "synthetic example email or declared exmaple source typo required",
  );
export const csvRevision = z
  .string()
  .regex(/^[1-9][0-9]{0,15}$/)
  .refine(
    (v) => Number.isSafeInteger(Number(v)) && Number(v) >= 1,
    "canonical positive safe revision required",
  );
export const contact = z.strictObject({
  id: identifier,
  name: line(160),
  company: line(240),
  email: contactEmail,
  revision: csvRevision,
});
export const order = z.strictObject({
  id: identifier,
  contactId: identifier,
  email,
  status: z.enum(["Pending", "Shipped", "Cancelled"]),
  revision,
});
export const event = z.discriminatedUnion("type", [
  z.strictObject({
    id: identifier,
    orderId: identifier,
    type: z.literal("shipment_confirmed"),
    tracking: line(160),
  }),
  z.strictObject({
    id: identifier,
    orderId: identifier,
    type: z.literal("shipment_cancelled"),
  }),
]);
export const ordersFile = z.strictObject({
  orders: z.array(order).min(1).max(4000),
  events: z.array(event).max(8000),
});
export const emailRepair = z.strictObject({
  id: identifier,
  expectedRevision: revision,
  newEmail: email,
  evidenceOrderId: identifier,
});
export const statusRepair = z.strictObject({
  id: identifier,
  expectedRevision: revision,
  newStatus: z.literal("Shipped"),
  evidenceEventId: identifier,
});
const unique = (values, label) => {
  if (new Set(values).size !== values.length)
    throw Error(`duplicate ${label} id`);
};
export function validateRecords(contacts, json) {
  const rows = z.array(contact).min(1).max(2000).parse(contacts),
    data = ordersFile.parse(json);
  unique(
    rows.map((r) => r.id),
    "contact",
  );
  unique(
    data.orders.map((r) => r.id),
    "order",
  );
  unique(
    data.events.map((r) => r.id),
    "event",
  );
  const ids = new Set(rows.map((r) => r.id)),
    orders = new Set(data.orders.map((r) => r.id));
  if (data.orders.some((r) => !ids.has(r.contactId)))
    throw Error("order references missing contact");
  if (data.events.some((r) => !orders.has(r.orderId)))
    throw Error("shipment event references missing order");
  return { contacts: rows, ...data };
}

export { hash } from "./source.js";
export const canonical = (v) =>
  Array.isArray(v)
    ? `[${v.map(canonical).join(",")}]`
    : v !== null && typeof v === "object"
      ? `{${Object.keys(v)
          .sort()
          .map((k) => `${JSON.stringify(k)}:${canonical(v[k])}`)
          .join(",")}}`
      : JSON.stringify(v);
export const same = (a, b) => canonical(a) === canonical(b);
