import type {
  Locale,
  PacketForm,
  PacketTemplate,
  IntakeQuestion,
} from "./types";

export const COMPANY = {
  name: "ArchAngel Contractors",
  email: "admin@archangelcontractors.com",
  warrantyMonths: 12,
  terminationNoticeDays: 30,
  venue: "Collin County, Texas",
} as const;

/** All form codes that carry a bundled source legal PDF (per locale). */
export const SOURCE_PDF_CODES = [
  "00",
  "01",
  "A",
  "B",
  "L-ALT",
  "C",
  "D",
  "E",
  "M",
  "F-1",
  "F-2",
  "H",
  "K",
  "J",
  "O",
  "P",
] as const;

function tr(locale: Locale, en: string, es: string): string {
  return locale === "es" ? es : en;
}

function buildForms(locale: Locale): PacketForm[] {
  const t = (en: string, es: string) => tr(locale, en, es);

  const agree = t(
    "I have read, understand, and agree to this document.",
    "He leído, entiendo y acepto este documento.",
  );
  const subRole = t("Subcontractor", "Subcontratista");

  const sub = (agreeText?: string) => ({
    key: "sub",
    roleLabel: subRole,
    captureTitle: true,
    captureCompany: true,
    agreeText: agreeText ?? agree,
  });

  const forms: PacketForm[] = [
    {
      code: "00",
      kind: "info",
      title: t("Welcome to the Team", "Bienvenido al Equipo"),
      intro: t(
        "Read this quick welcome to see how the onboarding packet works.",
        "Lee esta bienvenida rápida para ver cómo funciona el paquete de incorporación.",
      ),
      hasSourcePdf: true,
      applicability: "always",
      fields: [],
      attachments: [],
    },
    {
      code: "01",
      kind: "info",
      title: t("Packet Index", "Índice del Paquete"),
      intro: t(
        "Overview of every form in this packet and the order you'll complete them.",
        "Resumen de cada formulario del paquete y el orden en que los completarás.",
      ),
      hasSourcePdf: true,
      applicability: "always",
      fields: [],
      attachments: [],
    },
    {
      code: "A",
      kind: "form",
      title: t(
        "Subcontractor Information & Payment",
        "Información y Pago del Subcontratista",
      ),
      intro: t(
        "Tell us who you are and how you'd like to be paid.",
        "Cuéntanos quién eres y cómo prefieres recibir el pago.",
      ),
      hasSourcePdf: true,
      applicability: "always",
      fields: [
        {
          key: "legalName",
          label: t("Legal / Business name", "Nombre legal / de la empresa"),
          type: "text",
          required: true,
          colSpan: 2,
        },
        {
          key: "dba",
          label: t("DBA (if any)", "Nombre comercial (si aplica)"),
          type: "text",
          colSpan: 2,
        },
        {
          key: "contactName",
          label: t("Primary contact", "Contacto principal"),
          type: "text",
          required: true,
        },
        {
          key: "phone",
          label: t("Phone", "Teléfono"),
          type: "tel",
          required: true,
        },
        {
          key: "email",
          label: t("Email", "Correo electrónico"),
          type: "email",
          required: true,
        },
        {
          key: "trade",
          label: t("Trade / services", "Oficio / servicios"),
          type: "text",
          required: true,
        },
        {
          key: "address",
          label: t("Mailing address", "Dirección postal"),
          type: "text",
          required: true,
          colSpan: 2,
        },
        { key: "city", label: t("City", "Ciudad"), type: "text", required: true },
        {
          key: "state",
          label: t("State", "Estado"),
          type: "text",
          required: true,
        },
        { key: "zip", label: t("ZIP", "Código postal"), type: "text", required: true },
        {
          key: "entityType",
          label: t("Business type", "Tipo de empresa"),
          type: "radio",
          required: true,
          colSpan: 2,
          options: [
            { value: "sole", label: t("Sole proprietor", "Propietario único") },
            { value: "llc", label: t("LLC", "LLC") },
            { value: "corp", label: t("Corporation", "Corporación") },
            { value: "partnership", label: t("Partnership", "Sociedad") },
          ],
        },
        {
          key: "preferredPayment",
          label: t("Preferred payment method", "Método de pago preferido"),
          type: "radio",
          required: true,
          colSpan: 2,
          options: [
            { value: "ach", label: t("ACH / direct deposit", "ACH / depósito directo") },
            { value: "check", label: t("Check", "Cheque") },
            { value: "zelle", label: t("Zelle", "Zelle") },
          ],
        },
      ],
      attachments: [],
      signature: sub(),
    },
    {
      code: "W9",
      kind: "form",
      title: t("IRS Form W-9", "Formulario W-9 del IRS"),
      intro: t(
        "Your taxpayer information, required before we can pay you.",
        "Tu información de contribuyente, requerida antes de poder pagarte.",
      ),
      hasSourcePdf: false,
      applicability: "always",
      fields: [
        {
          key: "name",
          label: t("Name (as shown on tax return)", "Nombre (como aparece en tu declaración)"),
          type: "text",
          required: true,
          colSpan: 2,
        },
        {
          key: "businessName",
          label: t("Business name (if different)", "Nombre de la empresa (si es distinto)"),
          type: "text",
          colSpan: 2,
        },
        {
          key: "taxClassification",
          label: t("Federal tax classification", "Clasificación fiscal federal"),
          type: "radio",
          required: true,
          colSpan: 2,
          options: [
            { value: "individual", label: t("Individual / sole proprietor", "Individuo / propietario único") },
            { value: "c_corp", label: t("C corporation", "Corporación C") },
            { value: "s_corp", label: t("S corporation", "Corporación S") },
            { value: "partnership", label: t("Partnership", "Sociedad") },
            { value: "llc", label: t("LLC", "LLC") },
          ],
        },
        {
          key: "address",
          label: t("Address", "Dirección"),
          type: "text",
          required: true,
          colSpan: 2,
        },
        { key: "city", label: t("City", "Ciudad"), type: "text", required: true },
        { key: "state", label: t("State", "Estado"), type: "text", required: true },
        { key: "zip", label: t("ZIP", "Código postal"), type: "text", required: true },
        {
          key: "tinType",
          label: t("Taxpayer ID type", "Tipo de identificación fiscal"),
          type: "radio",
          required: true,
          options: [
            { value: "ssn", label: t("SSN", "SSN") },
            { value: "ein", label: t("EIN", "EIN") },
          ],
        },
        {
          key: "ssn",
          label: t("SSN", "SSN"),
          type: "text",
          placeholder: "XXX-XX-XXXX",
        },
        {
          key: "ein",
          label: t("EIN", "EIN"),
          type: "text",
          placeholder: "XX-XXXXXXX",
        },
      ],
      attachments: [],
      signature: {
        key: "sub",
        roleLabel: subRole,
        agreeText: t(
          "Under penalties of perjury, I certify that the information above is true and correct.",
          "Bajo pena de perjurio, certifico que la información anterior es verdadera y correcta.",
        ),
      },
    },
    {
      code: "B",
      kind: "form",
      title: t(
        "Master Subcontractor Agreement",
        "Contrato Maestro de Subcontratista",
      ),
      intro: t(
        "The comprehensive agreement that governs our working relationship.",
        "El contrato integral que rige nuestra relación de trabajo.",
      ),
      hasSourcePdf: true,
      applicability: "always",
      fields: [],
      attachments: [],
      signature: sub(),
    },
    {
      code: "L-ALT",
      kind: "form",
      title: t(
        "Field Standards & Payment Terms (Non-Net-30)",
        "Normas de Campo y Términos de Pago (No Net 30)",
      ),
      intro: t(
        "Jobsite standards and the payment schedule for this engagement.",
        "Normas del sitio de trabajo y el calendario de pagos para este trabajo.",
      ),
      hasSourcePdf: true,
      applicability: "always",
      fields: [
        {
          key: "termsAck",
          label: t(
            "I acknowledge the field standards and the Non-Net-30 payment terms.",
            "Reconozco las normas de campo y los términos de pago No Net 30.",
          ),
          type: "checkbox",
          required: true,
          colSpan: 2,
        },
      ],
      attachments: [],
      signature: sub(),
    },
    {
      code: "C",
      kind: "form",
      title: t("Mutual NDA", "Acuerdo Mutuo de Confidencialidad (NDA)"),
      intro: t(
        "Keeps each other's confidential information protected.",
        "Protege la información confidencial de ambas partes.",
      ),
      hasSourcePdf: true,
      applicability: "always",
      fields: [],
      attachments: [],
      signature: sub(),
    },
    {
      code: "D",
      kind: "form",
      title: t(
        "Non-Solicitation & Non-Compete",
        "No Solicitación y No Competencia",
      ),
      intro: t(
        "Terms protecting client relationships during and after the engagement.",
        "Términos que protegen las relaciones con los clientes durante y después del trabajo.",
      ),
      hasSourcePdf: true,
      applicability: "always",
      fields: [],
      attachments: [],
      signature: sub(),
    },
    {
      code: "E",
      kind: "form",
      title: t(
        "Insurance, Indemnity & Hold-Harmless",
        "Seguro, Indemnización y Exoneración",
      ),
      intro: t(
        "Your insurance, indemnity, and hold-harmless obligations.",
        "Tus obligaciones de seguro, indemnización y exoneración.",
      ),
      hasSourcePdf: true,
      applicability: "always",
      fields: [],
      attachments: [],
      signature: sub(),
    },
    {
      code: "M",
      kind: "form",
      title: t(
        "Release, Waiver & Assumption of Risk",
        "Exención, Renuncia y Asunción de Riesgo",
      ),
      intro: t(
        "Acknowledgment of jobsite risks and release of liability.",
        "Reconocimiento de los riesgos del sitio y renuncia de responsabilidad.",
      ),
      hasSourcePdf: true,
      applicability: "always",
      fields: [],
      attachments: [],
      signature: sub(),
    },
    {
      code: "F-1",
      kind: "form",
      title: t("Insurance & COI", "Seguro y COI"),
      intro: t(
        "For insured subcontractors: your carrier details and Certificate of Insurance.",
        "Para subcontratistas asegurados: los datos de tu aseguradora y el Certificado de Seguro.",
      ),
      hasSourcePdf: true,
      applicability: "insured",
      fields: [
        {
          key: "carrier",
          label: t("Insurance carrier", "Compañía de seguros"),
          type: "text",
          required: true,
          colSpan: 2,
        },
        {
          key: "policyNumber",
          label: t("Policy number", "Número de póliza"),
          type: "text",
          required: true,
        },
        {
          key: "expiration",
          label: t("Expiration date", "Fecha de vencimiento"),
          type: "date",
          required: true,
        },
      ],
      attachments: [
        {
          key: "coi",
          label: t("Certificate of Insurance (COI)", "Certificado de Seguro (COI)"),
          required: true,
          help: t("PDF or image", "PDF o imagen"),
        },
      ],
      signature: sub(),
    },
    {
      code: "F-2",
      kind: "form",
      title: t(
        "No-Insurance Acknowledgment & Waiver",
        "Reconocimiento y Renuncia por Falta de Seguro",
      ),
      intro: t(
        "For subcontractors without their own coverage: acknowledgment and waiver.",
        "Para subcontratistas sin cobertura propia: reconocimiento y renuncia.",
      ),
      hasSourcePdf: true,
      applicability: "not_insured",
      fields: [
        {
          key: "noCoverageAck",
          label: t(
            "I confirm I do not currently carry my own liability insurance.",
            "Confirmo que actualmente no tengo mi propio seguro de responsabilidad.",
          ),
          type: "checkbox",
          required: true,
          colSpan: 2,
        },
        {
          key: "reason",
          label: t("Reason / notes (optional)", "Motivo / notas (opcional)"),
          type: "textarea",
          colSpan: 2,
        },
      ],
      attachments: [],
      signature: sub(),
    },
    {
      code: "H",
      kind: "form",
      title: t(
        "Authorized Workers & Certification",
        "Trabajadores Autorizados y Certificación",
      ),
      intro: t(
        "List everyone authorized to work under your company on our jobs.",
        "Enumera a todas las personas autorizadas a trabajar bajo tu empresa en nuestros trabajos.",
      ),
      hasSourcePdf: true,
      applicability: "always",
      fields: [
        {
          key: "workers",
          label: t("Authorized workers", "Trabajadores autorizados"),
          type: "workers",
          required: true,
          colSpan: 2,
        },
      ],
      attachments: [],
      signature: sub(
        t(
          "I certify that everyone listed is authorized to work in the United States.",
          "Certifico que todas las personas enumeradas están autorizadas para trabajar en los Estados Unidos.",
        ),
      ),
    },
    {
      code: "K",
      kind: "form",
      title: t("Payment Authorization (ACH)", "Autorización de Pago (ACH)"),
      intro: t(
        "Bank details so we can pay you by direct deposit.",
        "Datos bancarios para pagarte por depósito directo.",
      ),
      hasSourcePdf: true,
      applicability: "ach",
      fields: [
        {
          key: "bankName",
          label: t("Bank name", "Nombre del banco"),
          type: "text",
          required: true,
          colSpan: 2,
        },
        {
          key: "accountName",
          label: t("Name on account", "Nombre en la cuenta"),
          type: "text",
          required: true,
          colSpan: 2,
        },
        {
          key: "routingNumber",
          label: t("Routing number", "Número de ruta"),
          type: "text",
          required: true,
        },
        {
          key: "accountNumber",
          label: t("Account number", "Número de cuenta"),
          type: "text",
          required: true,
        },
        {
          key: "accountType",
          label: t("Account type", "Tipo de cuenta"),
          type: "radio",
          required: true,
          colSpan: 2,
          options: [
            { value: "checking", label: t("Checking", "Corriente") },
            { value: "savings", label: t("Savings", "Ahorros") },
          ],
        },
      ],
      attachments: [
        {
          key: "voidedCheck",
          label: t("Voided check (optional)", "Cheque anulado (opcional)"),
          help: t("PDF or image", "PDF o imagen"),
        },
      ],
      signature: sub(
        t(
          "I authorize ArchAngel Contractors to deposit payments to the account above.",
          "Autorizo a ArchAngel Contractors a depositar pagos en la cuenta anterior.",
        ),
      ),
    },
    {
      code: "J",
      kind: "form",
      title: t(
        "Master Acknowledgment & Signature",
        "Reconocimiento Maestro y Firma",
      ),
      intro: t(
        "Final acknowledgment that you've read and agreed to the entire packet.",
        "Reconocimiento final de que has leído y aceptado todo el paquete.",
      ),
      hasSourcePdf: true,
      applicability: "always",
      fields: [],
      attachments: [],
      signature: sub(
        t(
          "I have read, understand, and agree to every document in this packet.",
          "He leído, entiendo y acepto todos los documentos de este paquete.",
        ),
      ),
    },
    {
      code: "O",
      kind: "info",
      title: t(
        "Invoicing & Payment Guide",
        "Guía de Facturación y Pago",
      ),
      intro: t(
        "Reference: how to invoice ArchAngel and get paid.",
        "Referencia: cómo facturar a ArchAngel y recibir el pago.",
      ),
      hasSourcePdf: true,
      applicability: "always",
      fields: [],
      attachments: [],
    },
    {
      code: "P",
      kind: "info",
      title: t("Sample Invoice", "Factura de Muestra"),
      intro: t(
        "Reference: a sample subcontractor invoice.",
        "Referencia: una factura de muestra para subcontratistas.",
      ),
      hasSourcePdf: true,
      applicability: "always",
      fields: [],
      attachments: [],
    },
  ];

  return forms;
}

function buildIntake(locale: Locale): IntakeQuestion[] {
  const t = (en: string, es: string) => tr(locale, en, es);
  return [
    {
      key: "insured",
      label: t(
        "Do you carry your own liability insurance?",
        "¿Tienes tu propio seguro de responsabilidad?",
      ),
      help: t(
        "Insured crews complete Form F-1 with a COI. Others complete Form F-2.",
        "Los equipos asegurados completan el Formulario F-1 con un COI. Los demás completan el Formulario F-2.",
      ),
      yesLabel: t("Yes, I'm insured", "Sí, estoy asegurado"),
      noLabel: t("No coverage", "Sin cobertura"),
    },
    {
      key: "ach",
      label: t(
        "Do you want to be paid by ACH / direct deposit?",
        "¿Quieres recibir el pago por ACH / depósito directo?",
      ),
      help: t(
        "If yes, you'll complete the ACH authorization (Form K).",
        "Si es así, completarás la autorización ACH (Formulario K).",
      ),
      yesLabel: t("Yes, use ACH", "Sí, usar ACH"),
      noLabel: t("No, another method", "No, otro método"),
    },
  ];
}

export function buildTemplate(locale: Locale): PacketTemplate {
  return {
    key: locale === "es" ? "welcome-es-non-net30" : "welcome-en-non-net30",
    locale,
    label:
      locale === "es"
        ? "Paquete de Bienvenida — Español (No Net 30)"
        : "Welcome Packet — English (Non-Net-30)",
    shortLabel:
      locale === "es" ? "Bienvenida (Español)" : "Welcome (English)",
    netTerms: "non-net30",
    intake: buildIntake(locale),
    forms: buildForms(locale),
  };
}

export const PACKET_TEMPLATES: PacketTemplate[] = [
  buildTemplate("en"),
  buildTemplate("es"),
];

export function getTemplate(key: string): PacketTemplate | null {
  return PACKET_TEMPLATES.find((tpl) => tpl.key === key) ?? null;
}

export function listTemplates(): { key: string; label: string; locale: Locale }[] {
  return PACKET_TEMPLATES.map((tpl) => ({
    key: tpl.key,
    label: tpl.label,
    locale: tpl.locale,
  }));
}

/** Forms that apply given the crew's onboarding answers, in order. */
export function applicableForms(
  tpl: PacketTemplate,
  answers: { insured: boolean; ach: boolean },
): PacketForm[] {
  return tpl.forms.filter((f) => {
    switch (f.applicability) {
      case "always":
        return true;
      case "insured":
        return answers.insured;
      case "not_insured":
        return !answers.insured;
      case "ach":
        return answers.ach;
      default:
        return false;
    }
  });
}

/** Forms the crew must actively complete (has fields or a signature). */
export function completableForms(
  tpl: PacketTemplate,
  answers: { insured: boolean; ach: boolean },
): PacketForm[] {
  return applicableForms(tpl, answers).filter(
    (f) => f.kind === "form" && (f.fields.length > 0 || f.signature != null),
  );
}
