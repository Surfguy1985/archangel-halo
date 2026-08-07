import React, { useState } from 'react';
import {
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';

type Lang = 'en' | 'es';

const GUIDE = {
  en: {
    title: 'How HALO Crew Works',
    sections: [
      {
        icon: 'today-outline',
        heading: 'Your day workflow',
        body: `The Today tab walks you through every step of your day automatically.\n\n1. Check in when you arrive at the job site.\n2. Take before photos of the work area before starting.\n3. Complete your work items on the checklist.\n4. Take after photos when you're done.\n5. Submit your crew invoice.\n6. Check out.\n\nFollow each step and you'll never miss anything.`,
      },
      {
        icon: 'camera-outline',
        heading: 'Photos protect you',
        body: `Before and after photos are time-stamped and fingerprinted the moment they upload. They create tamper-proof evidence of your work.\n\nIf there's ever a dispute about what was done, your photos are your strongest protection. Take them every job, every time.`,
      },
      {
        icon: 'location-outline',
        heading: 'GPS tracking',
        body: `Your GPS location is shared with the office while you're checked in. This helps the team see where crews are and respond faster to emergencies.\n\nGPS automatically stops when you check out. Your privacy outside of work is fully respected.`,
      },
      {
        icon: 'flash-outline',
        heading: 'Job offers',
        body: `The office may send you job offers for additional work. You can accept or pass on any offer in the Offers section.\n\nEmergency offers are marked in red — they pay a bonus for same-day response. First crew to commit wins.`,
      },
      {
        icon: 'cash-outline',
        heading: 'Getting paid',
        body: `Submit a crew invoice after each job in the Invoices section. Once the office approves it, payment is processed according to your agreed payment terms.\n\nYou can track all your payments under My Pay.`,
      },
    ],
  },
  es: {
    title: 'Cómo funciona HALO Crew',
    sections: [
      {
        icon: 'today-outline',
        heading: 'Tu flujo de trabajo del día',
        body: `La pestaña "Hoy" te guía paso a paso durante el día.\n\n1. Regístrate cuando llegues al sitio de trabajo.\n2. Toma fotos "antes" del área de trabajo antes de comenzar.\n3. Completa los elementos de tu lista de verificación.\n4. Toma fotos "después" cuando hayas terminado.\n5. Envía tu factura.\n6. Haz check-out.\n\nSigue cada paso y nunca te perderás nada.`,
      },
      {
        icon: 'camera-outline',
        heading: 'Las fotos te protegen',
        body: `Las fotos de antes y después son marcadas con fecha y hora en el momento en que se suben. Crean evidencia inalterable de tu trabajo.\n\nSi alguna vez hay una disputa sobre lo que se hizo, tus fotos son tu mayor protección. Tómalas en cada trabajo, siempre.`,
      },
      {
        icon: 'location-outline',
        heading: 'Seguimiento GPS',
        body: `Tu ubicación GPS se comparte con la oficina mientras estás registrado. Esto ayuda al equipo a ver dónde están los equipos y responder más rápido a las emergencias.\n\nEl GPS se detiene automáticamente cuando haces check-out. Tu privacidad fuera del trabajo se respeta completamente.`,
      },
      {
        icon: 'flash-outline',
        heading: 'Ofertas de trabajo',
        body: `La oficina puede enviarte ofertas de trabajo adicionales. Puedes aceptar o rechazar cualquier oferta en la sección Ofertas.\n\nLas ofertas de emergencia están marcadas en rojo — pagan un bono por respuesta el mismo día. El primer equipo en comprometerse gana.`,
      },
      {
        icon: 'cash-outline',
        heading: 'Cómo te pagan',
        body: `Envía una factura después de cada trabajo en la sección Facturas. Una vez que la oficina la apruebe, el pago se procesa según los términos de pago acordados.\n\nPuedes ver todos tus pagos en Mi Pago.`,
      },
    ],
  },
};

export default function GuideScreen() {
  const insets = useSafeAreaInsets();
  const [lang, setLang] = useState<Lang>('en');
  const [openIdx, setOpenIdx] = useState<number | null>(0);
  const guide = GUIDE[lang];
  const bottomPad = insets.bottom + (Platform.OS === 'web' ? 34 : 0);

  return (
    <View style={s.container}>
      {/* Lang toggle */}
      <View style={s.langRow}>
        {(['en', 'es'] as Lang[]).map((l) => (
          <Pressable
            key={l}
            style={[s.langBtn, lang === l && s.langBtnActive]}
            onPress={() => {
              setLang(l);
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
            }}
          >
            <Text style={[s.langText, lang === l && s.langTextActive]}>
              {l === 'en' ? 'English' : 'Español'}
            </Text>
          </Pressable>
        ))}
      </View>

      <ScrollView
        contentContainerStyle={[s.content, { paddingBottom: bottomPad + 20 }]}
      >
        <Text style={s.guideTitle}>{guide.title}</Text>

        {guide.sections.map((sec, i) => (
          <Pressable
            key={i}
            style={s.accordion}
            onPress={() => {
              setOpenIdx(openIdx === i ? null : i);
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
            }}
          >
            <View style={s.accordionHeader}>
              <View style={s.accordionIcon}>
                <Ionicons name={sec.icon as any} size={20} color="#B4FF44" />
              </View>
              <Text style={s.accordionTitle}>{sec.heading}</Text>
              <Ionicons
                name={openIdx === i ? 'chevron-up' : 'chevron-down'}
                size={18}
                color="#435A7D"
              />
            </View>
            {openIdx === i && (
              <Text style={s.accordionBody}>{sec.body}</Text>
            )}
          </Pressable>
        ))}
      </ScrollView>
    </View>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#07101E' },
  langRow: {
    flexDirection: 'row',
    gap: 10,
    padding: 16,
    paddingBottom: 8,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(140,160,185,0.10)',
  },
  langBtn: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: 10,
    alignItems: 'center',
    backgroundColor: 'rgba(140,160,185,0.08)',
    borderWidth: 1,
    borderColor: 'rgba(140,160,185,0.14)',
  },
  langBtnActive: {
    backgroundColor: 'rgba(180,255,68,0.12)',
    borderColor: 'rgba(180,255,68,0.30)',
  },
  langText: {
    fontSize: 14,
    fontFamily: 'Inter_500Medium',
    color: '#435A7D',
  },
  langTextActive: { color: '#B4FF44', fontFamily: 'Inter_600SemiBold' },
  content: { padding: 16, gap: 10 },
  guideTitle: {
    fontSize: 22,
    fontFamily: 'Inter_700Bold',
    color: '#F4F7F9',
    marginBottom: 8,
  },
  accordion: {
    backgroundColor: '#13223A',
    borderRadius: 16,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: 'rgba(140,160,185,0.12)',
  },
  accordionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 16,
  },
  accordionIcon: {
    width: 38,
    height: 38,
    borderRadius: 10,
    backgroundColor: 'rgba(180,255,68,0.10)',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  accordionTitle: {
    flex: 1,
    fontSize: 15,
    fontFamily: 'Inter_600SemiBold',
    color: '#F4F7F9',
  },
  accordionBody: {
    fontSize: 14,
    fontFamily: 'Inter_400Regular',
    color: '#8CA0B9',
    lineHeight: 22,
    paddingHorizontal: 16,
    paddingBottom: 18,
  },
});
