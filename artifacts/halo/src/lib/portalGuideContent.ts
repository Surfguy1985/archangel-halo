export type GuideLang = "en" | "es";

export type GuideSection = {
  icon: string;
  title: string;
  body: string;
};

export type GuideContent = {
  heading: string;
  intro: string;
  langLabel: string;
  sections: GuideSection[];
  footer: string;
};

export const portalGuide: Record<GuideLang, GuideContent> = {
  en: {
    heading: "How to use your portal",
    intro:
      "This page is your connection to the office. No app to download, no password — just save this link and open it any time. Here's what each tab does.",
    langLabel: "English",
    sections: [
      {
        icon: "Briefcase",
        title: "Offers — grab new work",
        body: "When the office broadcasts a job, it shows up here with the details, photos, and pay. The first crew to accept gets the job, so check your offers when you get a notification.",
      },
      {
        icon: "Calendar",
        title: "Schedule — see your jobs",
        body: "Your assigned jobs and dates live here, with the property address and any access notes like gate codes. Check it each morning so you know where to be.",
      },
      {
        icon: "MapPin",
        title: "Job Tracker — check in and out",
        body: "When you arrive at a job, tap Check In. When you finish, tap Check Out. Your time and location are recorded as proof you were on site — this protects you and speeds up your pay.",
      },
      {
        icon: "Camera",
        title: "Photos — show your work",
        body: "Take before and after photos on every job and upload them here. The office sees them instantly and uses them to bill the client, so more photos means faster invoicing.",
      },
      {
        icon: "Receipt",
        title: "Invoice — bill for your work",
        body: "Send the office an invoice for your completed work right from your phone. You can see what you've billed and what's been paid.",
      },
      {
        icon: "MessageSquare",
        title: "Messages — talk to the office",
        body: "Send and receive messages with the office here. A red badge means there's something new for you.",
      },
      {
        icon: "ClipboardCheck",
        title: "Paperwork — Welcome Kit, W-9, and Pay",
        body: "The Welcome Kit tab has documents from the office. Fill out your W-9 once, and set up how you want to be paid in the Pay tab. Do this first so payments never get held up.",
      },
    ],
    footer:
      "Tip: save this link to your home screen so it opens like an app. Questions? Send the office a message from the Messages tab.",
  },
  es: {
    heading: "Cómo usar su portal",
    intro:
      "Esta página es su conexión con la oficina. No hay que descargar ninguna aplicación ni usar contraseña — solo guarde este enlace y ábralo cuando quiera. Esto es lo que hace cada pestaña.",
    langLabel: "Español",
    sections: [
      {
        icon: "Briefcase",
        title: "Ofertas — tome trabajos nuevos",
        body: "Cuando la oficina publica un trabajo, aparece aquí con los detalles, fotos y el pago. El primer equipo que acepta se queda con el trabajo, así que revise sus ofertas cuando reciba una notificación.",
      },
      {
        icon: "Calendar",
        title: "Horario — vea sus trabajos",
        body: "Aquí están sus trabajos asignados y las fechas, con la dirección de la propiedad y notas de acceso como códigos de portón. Revíselo cada mañana para saber a dónde ir.",
      },
      {
        icon: "MapPin",
        title: "Registro de trabajo — marque entrada y salida",
        body: "Cuando llegue a un trabajo, toque Registrar entrada. Cuando termine, toque Registrar salida. Su hora y ubicación quedan registradas como prueba de que estuvo en el sitio — esto lo protege y acelera su pago.",
      },
      {
        icon: "Camera",
        title: "Fotos — muestre su trabajo",
        body: "Tome fotos de antes y después en cada trabajo y súbalas aquí. La oficina las ve al instante y las usa para cobrar al cliente, así que más fotos significa facturación más rápida.",
      },
      {
        icon: "Receipt",
        title: "Factura — cobre por su trabajo",
        body: "Envíe a la oficina una factura por su trabajo terminado directamente desde su teléfono. Puede ver lo que ha facturado y lo que ya le pagaron.",
      },
      {
        icon: "MessageSquare",
        title: "Mensajes — hable con la oficina",
        body: "Envíe y reciba mensajes con la oficina aquí. Un círculo rojo significa que hay algo nuevo para usted.",
      },
      {
        icon: "ClipboardCheck",
        title: "Papeleo — Kit de bienvenida, W-9 y Pago",
        body: "La pestaña Kit de bienvenida tiene documentos de la oficina. Llene su W-9 una sola vez y configure cómo quiere que le paguen en la pestaña Pago. Haga esto primero para que sus pagos nunca se retrasen.",
      },
    ],
    footer:
      "Consejo: guarde este enlace en su pantalla de inicio para que se abra como una aplicación. ¿Preguntas? Envíe un mensaje a la oficina desde la pestaña Mensajes.",
  },
};
