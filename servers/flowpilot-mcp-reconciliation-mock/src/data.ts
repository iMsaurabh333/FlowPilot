import type { MockSystem } from "./config.js";

export interface ReconciliationRecord {
  applicationMessageId: string;
  status: string;
  [field: string]: string;
}
export interface DefectRecord {
  defectId: string;
  transactionId: string;
  system: string;
  summary: string;
  status: string;
  priority: string;
  details: string;
}

const abcWarehouse: ReconciliationRecord[] = [
  { applicationMessageId: "MSG-000001", status: "Dispatched", warehouseOrderId: "ABC-WH-1001", fulfillmentStatus: "Released", shippedAt: "2026-09-14T08:30:00Z", facility: "Bengaluru-01" },
  { applicationMessageId: "MSG-000002", status: "On hold", warehouseOrderId: "ABC-WH-1002", fulfillmentStatus: "Inventory pending", shippedAt: "", facility: "Bengaluru-01" },
  { applicationMessageId: "MSG-000003", status: "Delivered to carrier", warehouseOrderId: "ABC-WH-1003", fulfillmentStatus: "Released", shippedAt: "2026-09-14T11:45:00Z", facility: "Mumbai-02" },
  { applicationMessageId: "575990", status: "Packed", warehouseOrderId: "ABC-WH-575990", fulfillmentStatus: "Ready for carrier", shippedAt: "", facility: "Bengaluru-01" },
  { applicationMessageId: "763968", status: "Dispatched", warehouseOrderId: "ABC-WH-763968", fulfillmentStatus: "Released", shippedAt: "2026-09-15T04:15:00Z", facility: "Mumbai-02" },
  { applicationMessageId: "861822", status: "On hold", warehouseOrderId: "ABC-WH-861822", fulfillmentStatus: "Address verification", shippedAt: "", facility: "Bengaluru-01" },
  { applicationMessageId: "399085", status: "Delivered to carrier", warehouseOrderId: "ABC-WH-399085", fulfillmentStatus: "Released", shippedAt: "2026-09-15T06:40:00Z", facility: "Mumbai-02" }
];
const xyzTms: ReconciliationRecord[] = [
  { applicationMessageId: "MSG-000001", status: "In transit", shipmentId: "XYZ-TMS-5001", trackingNumber: "XYZIN5001", carrier: "NorthStar Logistics", estimatedDelivery: "2026-09-16T18:00:00Z" },
  { applicationMessageId: "MSG-000002", status: "Awaiting handoff", shipmentId: "XYZ-TMS-5002", trackingNumber: "", carrier: "", estimatedDelivery: "" },
  { applicationMessageId: "MSG-000004", status: "Delivered", shipmentId: "XYZ-TMS-5004", trackingNumber: "XYZIN5004", carrier: "NorthStar Logistics", estimatedDelivery: "2026-09-14T14:20:00Z" },
  { applicationMessageId: "575990", status: "Awaiting pickup", shipmentId: "XYZ-TMS-575990", trackingNumber: "XYZIN575990", carrier: "NorthStar Logistics", estimatedDelivery: "2026-09-18T18:00:00Z" },
  { applicationMessageId: "763968", status: "In transit", shipmentId: "XYZ-TMS-763968", trackingNumber: "XYZIN763968", carrier: "NorthStar Logistics", estimatedDelivery: "2026-09-17T18:00:00Z" },
  { applicationMessageId: "861822", status: "Exception", shipmentId: "XYZ-TMS-861822", trackingNumber: "XYZIN861822", carrier: "NorthStar Logistics", estimatedDelivery: "" },
  { applicationMessageId: "399085", status: "Delivered", shipmentId: "XYZ-TMS-399085", trackingNumber: "XYZIN399085", carrier: "NorthStar Logistics", estimatedDelivery: "2026-09-15T09:10:00Z" }
];
const defects: DefectRecord[] = [
  { defectId: "CPI-611889", transactionId: "611889", system: "CPI", summary: "Purchasing organization is missing for the purchase order.", status: "Open", priority: "High", details: "The transaction could not be completed because the purchase order has no purchasing organization." },
  { defectId: "CPI-173470", transactionId: "173470", system: "CPI", summary: "Duplicate business partner record detected.", status: "In progress", priority: "Medium", details: "Processing stopped after the integration detected an existing business partner with matching master-data keys." },
  { defectId: "WH-861822", transactionId: "861822", system: "ABC Warehouse", summary: "Warehouse order is on hold for address verification.", status: "Open", priority: "High", details: "Derived from ABC Warehouse status: On hold; fulfillment cannot proceed until the delivery address is verified." },
  { defectId: "TMS-861822", transactionId: "861822", system: "XYZ TMS", summary: "Shipment exception requires carrier follow-up.", status: "Open", priority: "High", details: "Derived from XYZ TMS status: Exception; the carrier has not supplied an estimated delivery date." },
  { defectId: "TMS-575990", transactionId: "575990", system: "XYZ TMS", summary: "Shipment is awaiting pickup.", status: "Investigating", priority: "Medium", details: "Derived from XYZ TMS status: Awaiting pickup; carrier handoff is pending." },
];

export function findRecord(system: MockSystem, applicationMessageId: string) {
  return (system === "abc-warehouse" ? abcWarehouse : xyzTms).find((record) => record.applicationMessageId === applicationMessageId);
}

export function findDefect(defectId: string) { return defects.find((defect) => defect.defectId === defectId); }
