export interface SourceRow {
  id: string;
  code: string;
  name: string;
  channel: 'ONLINE' | 'OFFLINE';
  adapter: 'API' | 'WEBHOOK' | 'CSV_IMPORT' | 'MANUAL';
  isLive: boolean;
  isActive: boolean;
  adapterNote: string;
  webhookPath: string | null;
  acceptsManualEntry: boolean;
  acceptsImport: boolean;
  integration: { id: string; mode: string; status: string; lastSyncAt: string | null; lastError: string | null } | null;
  _count: { bookings: number };
}

export interface SupplierRow {
  id: string;
  code: string;
  name: string;
  type: string;
  phone: string | null;
  timezone: string;
  notes: string | null;
  isActive: boolean;
  contacts: { id: string; email: string; name: string | null; isPrimary: boolean }[];
  _count: { bookings: number };
}

export interface HotelRow {
  id: string;
  name: string;
  city: string;
  country: string;
  address: string | null;
  starRating: number | null;
  _count?: { bookings: number };
}

export interface UserOption {
  id: string;
  name: string;
}

export interface BookingRow {
  id: string;
  internalRef: string;
  externalRef: string | null;
  channel: 'ONLINE' | 'OFFLINE';
  sourceId: string;
  supplierId: string | null;
  hotelId: string | null;
  assignedToId: string | null;
  leadGuestName: string;
  guestEmail: string | null;
  guestPhone: string | null;
  adults: number;
  children: number;
  rooms: number;
  roomType: string | null;
  boardBasis: string | null;
  bookingDate: string;
  checkIn: string;
  checkOut: string;
  nights: number;
  currency: string;
  sellingAmount: string | null;
  costAmount: string | null;
  taxAmount: string | null;
  margin: string | null;
  status: string;
  paymentStatus: string;
  confirmationStatus: string;
  cancellationStatus: string;
  confirmationNumber: string | null;
  notes: string | null;
  version: number;
  missing: string[];
  createdAt: string;
  updatedAt: string;
  source: { id: string; code: string; name: string; channel: string; adapter: string };
  supplier: { id: string; code: string; name: string } | null;
  hotel: { id: string; name: string; city: string; country: string } | null;
  assignedTo: UserOption | null;
}

export interface BookingDetail extends BookingRow {
  createdBy: UserOption | null;
  changes: { id: string; changeType: string; origin: string; diff: Record<string, unknown>; createdAt: string; changedBy: { name: string } | null }[];
  documents: { id: string; fileName: string; mimeType: string; sizeBytes: number; createdAt: string; uploadedBy: { name: string } | null }[];
  reconciliationIssues: { id: string; type: string }[];
  matchedIssues: { id: string; type: string }[];
}
