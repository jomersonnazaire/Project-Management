import {
  DOCUMENT_STATES,
  DOCUMENT_STATUSES,
  PARTY_KINDS,
  FILE_KINDS,
  HOLIDAY_TYPES,
  MESSAGE_TYPES,
  NOTIFICATION_RETENTION_DAYS,
  NOTIFICATION_TYPES,
  TIME_TYPES,
  UPLOAD_PURPOSES,
} from '@xc8/shared';
import { Schema, model, type InferSchemaType } from 'mongoose';

const ObjectId = Schema.Types.ObjectId;

/** App settings (07 §2 `settings`). One document per key; `calendar` holds the working days. */
const settingSchema = new Schema(
  {
    key: { type: String, required: true, unique: true },
    workingDays: { type: [Number], default: undefined },
    /** Q-09: `timeLock` key — when last week's entries lock (Admin setting, no approval step). */
    timeLock: {
      type: new Schema(
        {
          enabled: { type: Boolean, required: true },
          weekday: { type: Number, min: 0, max: 6, required: true },
          hour: { type: Number, min: 0, max: 23, required: true },
        },
        { _id: false },
      ),
      default: undefined,
    },
    version: { type: Number, default: 0 },
    updatedBy: { type: ObjectId, ref: 'User', default: null },
  },
  { timestamps: true, strict: 'throw', collection: 'settings', versionKey: false },
);
export type Setting = InferSchemaType<typeof settingSchema>;
export const SettingModel = model('Setting', settingSchema);

/** Holiday calendar (FR-CAL-01). One entry per date (duplicates refused by a unique index). */
const holidaySchema = new Schema(
  {
    date: { type: Date, required: true, unique: true },
    year: { type: Number, required: true, index: true },
    name: { type: String, required: true, trim: true, maxlength: 120 },
    type: { type: String, enum: HOLIDAY_TYPES, required: true },
    note: { type: String, default: null },
  },
  { timestamps: true, strict: 'throw', collection: 'holidays', versionKey: false },
);
export type Holiday = InferSchemaType<typeof holidaySchema>;
export const HolidayModel = model('Holiday', holidaySchema);

/** Time entries (FR-TIME-01..08). */
const timeEntrySchema = new Schema(
  {
    userId: { type: ObjectId, ref: 'User', required: true },
    projectId: { type: ObjectId, ref: 'Project', required: true, index: true },
    taskId: { type: ObjectId, ref: 'Task', required: true, index: true },
    workDate: { type: Date, required: true },
    hours: { type: Number, required: true, min: 0.25, max: 24 },
    type: { type: String, enum: TIME_TYPES, default: 'EXECUTION' },
    notes: { type: String, default: null },
  },
  { timestamps: true, strict: 'throw', collection: 'timeEntries', versionKey: false },
);
timeEntrySchema.index({ userId: 1, workDate: 1 });
export type TimeEntry = InferSchemaType<typeof timeEntrySchema>;
export const TimeEntryModel = model('TimeEntry', timeEntrySchema);

/** Project folders (FR-DOC-01..05). Contracts and phase folders are created on first use. */
const folderSchema = new Schema(
  {
    projectId: { type: ObjectId, ref: 'Project', required: true, index: true },
    name: { type: String, required: true, trim: true, maxlength: 120 },
    /** Lower-cased name for the per-parent uniqueness check (FR-DOC-03). */
    nameKey: { type: String, required: true },
    parentId: { type: ObjectId, ref: 'Folder', default: null },
    kind: { type: String, enum: ['CONTRACTS', 'PHASE', 'CUSTOM', 'ISSUES'], default: 'CUSTOM' },
    /** For PHASE folders: the task phase they hold evidence for (FR-DOC-17). */
    phase: { type: String, default: null },
    order: { type: Number, default: 0 },
    /** FR-DOC-43: visible only to the PM, Admins and `allowedUserIds` (sub-folders inherit it). */
    restricted: { type: Boolean, default: false },
    allowedUserIds: { type: [ObjectId], ref: 'User', default: [] },
  },
  { timestamps: true, strict: 'throw', collection: 'folders', versionKey: false },
);
folderSchema.index({ projectId: 1, parentId: 1, nameKey: 1 }, { unique: true });
export type Folder = InferSchemaType<typeof folderSchema>;
export const FolderModel = model('Folder', folderSchema);

/** A user or a client contact (FR-DOC-10 requested-from, FR-DOC-25 signer). */
const partySchema = new Schema(
  {
    kind: { type: String, enum: PARTY_KINDS, required: true },
    id: { type: ObjectId, required: true },
  },
  { _id: false },
);

/** Documents and their versions (FR-DOC-10..33). Versions are never deleted (FR-DOC-32). */
const versionSchema = new Schema(
  {
    version: { type: Number, required: true },
    blobKey: { type: String, required: true },
    fileName: { type: String, required: true },
    size: { type: Number, required: true },
    mimeType: { type: String, required: true },
    sha256: { type: String, required: true },
    status: { type: String, enum: DOCUMENT_STATUSES, default: 'SUBMITTED' },
    uploadedBy: { type: ObjectId, ref: 'User' },
    uploadedAt: { type: Date, default: () => new Date() },
    note: { type: String, default: null },
    /** FR-DOC-25: signed by this client contact; `uploadedBy` recorded it. */
    signedBy: { type: partySchema, default: null },
  },
  { _id: false },
);
const documentSchema = new Schema(
  {
    projectId: { type: ObjectId, ref: 'Project', required: true, index: true },
    folderId: { type: ObjectId, ref: 'Folder', required: true, index: true },
    name: { type: String, required: true, trim: true, maxlength: 200 },
    nameKey: { type: String, required: true },
    /** null until a Requested document gets its first file. */
    kind: { type: String, enum: FILE_KINDS, default: null },
    status: { type: String, enum: DOCUMENT_STATES, default: 'SUBMITTED' },
    /** FR-DOC-20/22: documents that don't need a signature are complete at Submitted. */
    requiresSignature: { type: Boolean, default: false },
    /** Request a document (FR-DOC-20); null for direct uploads. */
    requestedBy: { type: ObjectId, ref: 'User', default: null },
    requestedFrom: { type: partySchema, default: null },
    dueDate: { type: Date, default: null },
    cancelled: {
      type: new Schema(
        { by: { type: ObjectId, ref: 'User' }, at: Date, reason: String },
        { _id: false },
      ),
      default: null,
    },
    signedVersion: { type: Number, default: null },
    taskId: { type: ObjectId, ref: 'Task', default: null, index: true },
    source: { type: String, enum: ['DOCUMENT', 'EVIDENCE', 'ISSUE'], default: 'DOCUMENT' },
    versions: { type: [versionSchema], default: [] },
    events: {
      type: [
        new Schema(
          {
            event: String,
            actorId: { type: ObjectId, ref: 'User' },
            at: { type: Date, default: () => new Date() },
            version: { type: Number, default: null },
            note: { type: String, default: null },
            onBehalfOf: { type: partySchema, default: null },
          },
          { _id: false },
        ),
      ],
      default: [],
    },
    archived: { type: Boolean, default: false },
    archivedReason: { type: String, default: null },
    createdBy: { type: ObjectId, ref: 'User', default: null },
  },
  { timestamps: true, strict: 'throw', collection: 'documents', versionKey: false },
);
documentSchema.index({ projectId: 1, folderId: 1, nameKey: 1 });
documentSchema.index({ 'requestedFrom.id': 1, status: 1, dueDate: 1 });
documentSchema.index({ status: 1, dueDate: 1 });
export type DocumentRec = InferSchemaType<typeof documentSchema>;
export const DocumentModel = model('Document', documentSchema);

/**
 * Upload tickets: issued before the browser uploads straight to storage, completed after the API
 * has checked the stored bytes (EC-59: nothing is recorded until the check passes).
 */
const uploadSchema = new Schema(
  {
    userId: { type: ObjectId, ref: 'User', required: true },
    projectId: { type: ObjectId, ref: 'Project', required: true },
    purpose: { type: String, enum: UPLOAD_PURPOSES, required: true },
    taskId: { type: ObjectId, ref: 'Task', default: null },
    issueId: { type: ObjectId, ref: 'Issue', default: null },
    folderId: { type: ObjectId, ref: 'Folder', default: null },
    fileName: { type: String, required: true },
    declaredSize: { type: Number, required: true },
    blobKey: { type: String, required: true },
    status: { type: String, enum: ['SUBMITTED', 'SIGNED'], default: 'SUBMITTED' },
    onDuplicate: { type: String, enum: ['NEW_VERSION', 'KEEP_BOTH'], default: 'NEW_VERSION' },
    note: { type: String, default: null },
    /** FR-DOC-21: the Requested document this file fulfils. */
    fulfilsDocumentId: { type: ObjectId, ref: 'Document', default: null },
    /** FR-DOC-25: client contact who signed the uploaded copy. */
    signedByContactId: { type: ObjectId, ref: 'ClientContact', default: null },
    state: { type: String, enum: ['PENDING', 'DONE', 'REJECTED'], default: 'PENDING' },
    rejectReason: { type: String, default: null },
    documentId: { type: ObjectId, ref: 'Document', default: null },
    expiresAt: { type: Date, required: true },
  },
  { timestamps: true, strict: 'throw', collection: 'uploads', versionKey: false },
);
export type Upload = InferSchemaType<typeof uploadSchema>;
export const UploadModel = model('Upload', uploadSchema);

/** In-app notifications (FR-NTF-01..06); removed after 90 days by a TTL index. */
const notificationSchema = new Schema(
  {
    userId: { type: ObjectId, ref: 'User', required: true },
    projectId: { type: ObjectId, ref: 'Project', required: true },
    taskId: { type: ObjectId, ref: 'Task', default: null },
    issueId: { type: ObjectId, ref: 'Issue', default: null },
    type: { type: String, enum: NOTIFICATION_TYPES, required: true },
    actorId: { type: ObjectId, ref: 'User', default: null },
    readAt: { type: Date, default: null },
    createdAt: { type: Date, default: () => new Date() },
  },
  { strict: 'throw', collection: 'notifications', versionKey: false },
);
notificationSchema.index({ userId: 1, createdAt: -1 });
notificationSchema.index(
  { createdAt: 1 },
  { expireAfterSeconds: NOTIFICATION_RETENTION_DAYS * 86_400 },
);
export type Notification = InferSchemaType<typeof notificationSchema>;
export const NotificationModel = model('Notification', notificationSchema);

/** Project conversation messages (FR-CNV-01..08). Permanent: no route edits or deletes them. */
const messageSchema = new Schema(
  {
    projectId: { type: ObjectId, ref: 'Project', required: true },
    authorId: { type: ObjectId, ref: 'User', required: true },
    type: { type: String, enum: MESSAGE_TYPES, default: 'NOTE' },
    text: { type: String, required: true, maxlength: 5000 },
    taskId: { type: ObjectId, ref: 'Task', default: null },
    contactIds: { type: [ObjectId], ref: 'ClientContact', default: [] },
    hidden: {
      type: new Schema(
        {
          by: { type: ObjectId, ref: 'User' },
          at: Date,
          reason: String,
        },
        { _id: false },
      ),
      default: null,
    },
    createdAt: { type: Date, default: () => new Date() },
  },
  { strict: 'throw', collection: 'messages', versionKey: false },
);
messageSchema.index({ projectId: 1, createdAt: 1 });
export type Message = InferSchemaType<typeof messageSchema>;
export const MessageModel = model('Message', messageSchema);
