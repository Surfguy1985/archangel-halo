export type Locale = "en" | "es";

export type FieldType =
  | "text"
  | "textarea"
  | "email"
  | "tel"
  | "date"
  | "select"
  | "radio"
  | "checkbox"
  | "workers";

export interface FieldOption {
  value: string;
  label: string;
}

export interface PacketField {
  key: string;
  label: string;
  type: FieldType;
  required?: boolean;
  placeholder?: string;
  options?: FieldOption[];
  colSpan?: 1 | 2;
  help?: string;
}

export interface PacketAttachment {
  key: string;
  label: string;
  required?: boolean;
  help?: string;
}

export interface SignatureBlock {
  key: string;
  roleLabel: string;
  captureTitle?: boolean;
  captureCompany?: boolean;
  agreeText: string;
}

/** Which onboarding answers make a form applicable. */
export type Applicability = "always" | "insured" | "not_insured" | "ach";

export interface PacketForm {
  /** Stable code, e.g. "00", "A", "W9", "F-1". */
  code: string;
  kind: "info" | "form";
  title: string;
  subtitle?: string;
  /** Short plain-language description shown above the document. */
  intro?: string;
  /** Whether a source legal PDF exists (rendered for reading + merged into the packet). */
  hasSourcePdf: boolean;
  applicability: Applicability;
  fields: PacketField[];
  attachments: PacketAttachment[];
  signature?: SignatureBlock;
}

export interface IntakeQuestion {
  key: "insured" | "ach";
  label: string;
  help?: string;
  yesLabel: string;
  noLabel: string;
}

export interface PacketTemplate {
  /** e.g. "welcome-en-non-net30". */
  key: string;
  locale: Locale;
  /** Dropdown label. */
  label: string;
  /** Short label for chips/badges. */
  shortLabel: string;
  netTerms: "non-net30";
  intake: IntakeQuestion[];
  forms: PacketForm[];
}

/** Runtime signature record captured per form. */
export interface SignatureValue {
  typedName: string;
  title?: string;
  company?: string;
  agreed: boolean;
  signedDate: string;
  agreedAt?: string;
  ip?: string;
  userAgent?: string;
}

export interface PacketApplicability {
  insured: boolean;
  ach: boolean;
}

export interface PacketAttachmentValue {
  key: string;
  name: string;
  storagePath: string;
  contentType?: string | null;
  size?: number | null;
}
