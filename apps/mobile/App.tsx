import React, { useMemo, useState } from 'react';
import {
  ActivityIndicator,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import * as Location from 'expo-location';

const API_BASE = process.env.EXPO_PUBLIC_API_URL || 'http://localhost:4000';

type Screen = 'home' | 'capture' | 'account';

type FieldSession = {
  access_token: string;
  agent: { agent_id: string; display_name: string; email?: string };
};

type Coordinates = {
  latitude: number;
  longitude: number;
  accuracy: number;
};

type ResolvedPlace = {
  postcode: string;
  address: string;
  source: string;
  confidence: number;
};

type QueuedObservation = {
  id: string;
  payload: Record<string, unknown>;
};

const shortSource = (source?: string) =>
  source === 'LOCAL_DEVELOPMENT_FIXTURE' ? 'Development fixture' : source || 'Source unavailable';

export default function ResolveGridMobileApp() {
  const [screen, setScreen] = useState<Screen>('home');
  const [fieldEmail, setFieldEmail] = useState('');
  const [fieldPassword, setFieldPassword] = useState('');
  const [fieldSession, setFieldSession] = useState<FieldSession | null>(null);
  const [addressQuery, setAddressQuery] = useState('');
  const [resolvedPlace, setResolvedPlace] = useState<ResolvedPlace | null>(null);
  const [manualPostcode, setManualPostcode] = useState('');
  const [coordinates, setCoordinates] = useState<Coordinates | null>(null);
  const [hasConsent, setHasConsent] = useState(false);
  const [gateDelaySec, setGateDelaySec] = useState('');
  const [compoundWalkMeters, setCompoundWalkMeters] = useState('');
  const [accessNotes, setAccessNotes] = useState('');
  const [queue, setQueue] = useState<QueuedObservation[]>([]);
  const [notice, setNotice] = useState('Sign in to begin a field verification.');
  const [isWorking, setIsWorking] = useState(false);

  const activePostcode = resolvedPlace?.postcode || manualPostcode.trim().toUpperCase();
  const coordinatesLabel = useMemo(() => {
    if (!coordinates) return 'No location captured';
    return `GPS locked · ±${coordinates.accuracy}m accuracy`;
  }, [coordinates]);

  const fieldName = fieldSession?.agent.display_name?.split(' ')[0] || 'Field agent';

  const captureGps = async (): Promise<Coordinates | null> => {
    setNotice('Requesting your device location…');
    const { status } = await Location.requestForegroundPermissionsAsync();
    if (status !== 'granted') {
      setNotice('Location permission is required to attach evidence to a visit.');
      return null;
    }

    try {
      const position = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.Highest,
      });
      const captured = {
        latitude: position.coords.latitude,
        longitude: position.coords.longitude,
        accuracy: Number((position.coords.accuracy ?? 5).toFixed(1)),
      };
      setCoordinates(captured);
      setNotice(`Location captured at ±${captured.accuracy}m accuracy.`);
      return captured;
    } catch {
      setNotice('We could not get a precise location. Move to an open area and try again.');
      return null;
    }
  };

  const signIn = async () => {
    if (!fieldEmail.trim() || !fieldPassword) {
      setNotice('Enter your field email and password to continue.');
      return;
    }
    setIsWorking(true);
    try {
      const response = await fetch(`${API_BASE}/v1/field/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: fieldEmail.trim(), password: fieldPassword }),
      });
      const data = await response.json();
      if (!response.ok) {
        setNotice(data.error || 'Unable to sign in right now.');
        return;
      }
      setFieldSession(data);
      setFieldPassword('');
      setNotice(`Signed in. ${data.agent.display_name}, you are ready for field work.`);
    } catch {
      setNotice('Sign-in needs a connection to the ResolveGrid service.');
    } finally {
      setIsWorking(false);
    }
  };

  const resolvePlace = async () => {
    if (!addressQuery.trim()) {
      setNotice('Enter an address or landmark first.');
      return;
    }
    setIsWorking(true);
    try {
      const response = await fetch(`${API_BASE}/v1/resolve`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          query: addressQuery.trim(),
          ...(coordinates ? { lat: coordinates.latitude, lng: coordinates.longitude } : {}),
        }),
      });
      const data = await response.json();
      if (!response.ok || !data.resolved || !data.primary_match) {
        setNotice(data.error || 'That address could not be resolved. Check the detail and try again.');
        return;
      }
      const match = data.primary_match;
      setResolvedPlace({
        postcode: match.postcode,
        address: data.standardized_address_block?.line_1_building || match.display || addressQuery,
        source: match.source,
        confidence: Number(data.confidence || 0),
      });
      setManualPostcode(match.postcode);
      setNotice(
        match.source === 'LOCAL_DEVELOPMENT_FIXTURE'
          ? 'Address found in the development fixture. It cannot receive real field evidence.'
          : 'Address resolved. Capture visit evidence when you are at the location.'
      );
    } catch {
      setNotice('Address resolution needs a connection. You can still enter an official postcode manually.');
    } finally {
      setIsWorking(false);
    }
  };

  const makeObservationPayload = (gps: Coordinates) => ({
    agent_id: fieldSession?.agent.agent_id,
    postcode: activePostcode,
    latitude: gps.latitude,
    longitude: gps.longitude,
    gps_accuracy_m: gps.accuracy,
    location_consent: true,
    gate_clearance_required: Number(gateDelaySec || 0) >= 60,
    measured_gate_delay_sec: Number(gateDelaySec || 0),
    compound_walk_meters: Number(compoundWalkMeters || 0),
    building_access_notes: accessNotes.trim(),
  });

  const postObservation = async (payload: Record<string, unknown>) => {
    if (!fieldSession) return { ok: false, retryable: false, message: 'Please sign in again.' };
    try {
      const response = await fetch(`${API_BASE}/v1/field/observations`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${fieldSession.access_token}`,
        },
        body: JSON.stringify(payload),
      });
      const data = await response.json();
      if (response.ok) return { ok: true, retryable: false, message: 'Evidence submitted successfully.' };
      return {
        ok: false,
        retryable: response.status >= 500,
        message: data.error || 'Evidence could not be submitted.',
      };
    } catch {
      return { ok: false, retryable: true, message: 'No connection. Evidence was kept in this session queue.' };
    }
  };

  const submitEvidence = async () => {
    if (!fieldSession) {
      setScreen('account');
      setNotice('Sign in before submitting field evidence.');
      return;
    }
    if (!activePostcode) {
      setNotice('Resolve the address or enter its official postcode first.');
      return;
    }
    if (!hasConsent) {
      setNotice('Record the location-consent confirmation before submitting.');
      return;
    }

    const gps = coordinates || (await captureGps());
    if (!gps) return;

    setIsWorking(true);
    const payload = makeObservationPayload(gps);
    const result = await postObservation(payload);
    if (result.ok) {
      setNotice(result.message);
      setGateDelaySec('');
      setCompoundWalkMeters('');
      setAccessNotes('');
      setHasConsent(false);
      setIsWorking(false);
      return;
    }
    if (result.retryable) {
      setQueue((current) => [...current, { id: `${Date.now()}`, payload }]);
      setNotice(`${result.message} Retry it before closing the app.`);
    } else {
      setNotice(result.message);
    }
    setIsWorking(false);
  };

  const retryQueue = async () => {
    if (!queue.length) return;
    setIsWorking(true);
    const remaining: QueuedObservation[] = [];
    for (const item of queue) {
      const result = await postObservation(item.payload);
      if (!result.ok) remaining.push(item);
    }
    setQueue(remaining);
    setNotice(
      remaining.length
        ? `${remaining.length} evidence record${remaining.length === 1 ? '' : 's'} still need a connection.`
        : 'All queued evidence was submitted.'
    );
    setIsWorking(false);
  };

  const resetVisit = () => {
    setResolvedPlace(null);
    setManualPostcode('');
    setAddressQuery('');
    setCoordinates(null);
    setHasConsent(false);
    setGateDelaySec('');
    setCompoundWalkMeters('');
    setAccessNotes('');
    setNotice('New visit started. Resolve an address or enter an official postcode.');
    setScreen('home');
  };

  if (!fieldSession) {
    return (
      <SafeAreaView style={styles.container}>
        <ScrollView contentContainerStyle={styles.authScroll} keyboardShouldPersistTaps="handled">
          <View style={styles.brandRow}>
            <View style={styles.mark}><Text style={styles.markText}>RG</Text></View>
            <Text style={styles.brand}>ResolveGrid</Text>
          </View>
          <View style={styles.authHero}>
            <Text style={styles.eyebrow}>FIELD OPERATIONS</Text>
            <Text style={styles.authTitle}>Evidence that starts where the road ends.</Text>
            <Text style={styles.authCopy}>
              Resolve locations, capture consented visit evidence, and give operations a clearer last-mile picture.
            </Text>
          </View>
          <View style={styles.card}>
            <Text style={styles.cardTitle}>Field agent sign in</Text>
            <Text style={styles.helper}>Use the account provisioned for you by your team.</Text>
            <Text style={styles.label}>Work email</Text>
            <TextInput
              accessibilityLabel="Field agent email"
              autoCapitalize="none"
              autoComplete="email"
              keyboardType="email-address"
              onChangeText={setFieldEmail}
              placeholder="you@company.com"
              placeholderTextColor={COLORS.muted}
              style={styles.input}
              value={fieldEmail}
            />
            <Text style={styles.label}>Password</Text>
            <TextInput
              accessibilityLabel="Field agent password"
              autoCapitalize="none"
              onChangeText={setFieldPassword}
              placeholder="Your password"
              placeholderTextColor={COLORS.muted}
              secureTextEntry
              style={styles.input}
              value={fieldPassword}
            />
            <TouchableOpacity disabled={isWorking} onPress={signIn} style={[styles.primaryButton, isWorking && styles.buttonDisabled]}>
              {isWorking ? <ActivityIndicator color="#fffdf8" /> : <Text style={styles.primaryButtonText}>Sign in to field work</Text>}
            </TouchableOpacity>
            <Text style={styles.statusNote}>{notice}</Text>
          </View>
          <Text style={styles.footerNote}>Your GPS is requested only when you choose to capture visit evidence.</Text>
        </ScrollView>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.appHeader}>
        <View style={styles.brandRow}>
          <View style={styles.mark}><Text style={styles.markText}>RG</Text></View>
          <View><Text style={styles.brand}>ResolveGrid</Text><Text style={styles.brandSub}>FIELD</Text></View>
        </View>
        <View style={styles.onlineChip}><View style={styles.onlineDot} /><Text style={styles.onlineText}>On duty</Text></View>
      </View>
      <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
        {screen === 'home' && (
          <>
            <Text style={styles.eyebrow}>TODAY</Text>
            <Text style={styles.pageTitle}>Good to see you, {fieldName}.</Text>
            <Text style={styles.pageCopy}>Start a visit when you arrive at a property. The record stays tied to your signed-in field identity.</Text>

            <View style={styles.card}>
              <View style={styles.cardHeading}><Text style={styles.cardTitle}>Start a field visit</Text><Text style={styles.step}>01</Text></View>
              <Text style={styles.helper}>Resolve an address to prefill a postcode, or use the official postcode supplied by your team.</Text>
              <Text style={styles.label}>Address or landmark</Text>
              <TextInput
                accessibilityLabel="Address or landmark"
                onChangeText={setAddressQuery}
                placeholder="e.g. Aminu Kano Crescent, Wuse II"
                placeholderTextColor={COLORS.muted}
                style={styles.input}
                value={addressQuery}
              />
              <TouchableOpacity disabled={isWorking} onPress={resolvePlace} style={styles.secondaryButton}>
                <Text style={styles.secondaryButtonText}>Resolve address</Text>
              </TouchableOpacity>
              <View style={styles.divider}><Text style={styles.dividerText}>OR</Text></View>
              <Text style={styles.label}>Official NIPOST postcode</Text>
              <TextInput
                accessibilityLabel="Official NIPOST postcode"
                autoCapitalize="characters"
                onChangeText={setManualPostcode}
                placeholder="FC-00-A00-AA-00"
                placeholderTextColor={COLORS.muted}
                style={styles.input}
                value={manualPostcode}
              />
              <TouchableOpacity onPress={() => setScreen('capture')} style={styles.primaryButton}>
                <Text style={styles.primaryButtonText}>Continue to evidence</Text>
              </TouchableOpacity>
            </View>

            {resolvedPlace && (
              <View style={styles.resolvedCard}>
                <View style={styles.sourceRow}><Text style={styles.sourceLabel}>{shortSource(resolvedPlace.source)}</Text><Text style={styles.confidence}>{Math.round(resolvedPlace.confidence * 100)}% match</Text></View>
                <Text style={styles.resolvedCode}>{resolvedPlace.postcode}</Text>
                <Text style={styles.resolvedAddress}>{resolvedPlace.address}</Text>
                {resolvedPlace.source === 'LOCAL_DEVELOPMENT_FIXTURE' && <Text style={styles.warning}>This development fixture is useful for testing only. The API will reject real evidence for it.</Text>}
              </View>
            )}

            <View style={styles.queueCard}>
              <View><Text style={styles.queueTitle}>Evidence queue</Text><Text style={styles.queueCopy}>{queue.length ? `${queue.length} submission${queue.length === 1 ? '' : 's'} waiting in this session` : 'Nothing waiting to be sent'}</Text></View>
              {queue.length > 0 && <TouchableOpacity disabled={isWorking} onPress={retryQueue} style={styles.queueButton}><Text style={styles.queueButtonText}>Retry</Text></TouchableOpacity>}
            </View>
          </>
        )}

        {screen === 'capture' && (
          <>
            <View style={styles.captureTop}><View><Text style={styles.eyebrow}>FIELD VISIT</Text><Text style={styles.pageTitle}>Capture evidence</Text></View><TouchableOpacity onPress={resetVisit}><Text style={styles.textButton}>New visit</Text></TouchableOpacity></View>
            <View style={styles.visitCard}>
              <Text style={styles.label}>POSTCODE</Text>
              <Text style={styles.visitCode}>{activePostcode || 'Not set yet'}</Text>
              <Text style={styles.visitAddress}>{resolvedPlace?.address || 'Enter an official postcode before submitting.'}</Text>
              {resolvedPlace && <Text style={styles.sourceLabel}>{shortSource(resolvedPlace.source)}</Text>}
            </View>
            <View style={styles.card}>
              <View style={styles.cardHeading}><Text style={styles.cardTitle}>Visit details</Text><Text style={styles.step}>02</Text></View>
              <Text style={styles.label}>Device location</Text>
              <View style={styles.gpsRow}><View><Text style={styles.gpsTitle}>{coordinatesLabel}</Text>{coordinates && <Text style={styles.gpsMeta}>{coordinates.latitude.toFixed(5)}, {coordinates.longitude.toFixed(5)}</Text>}</View><TouchableOpacity disabled={isWorking} onPress={captureGps} style={styles.locationButton}><Text style={styles.locationButtonText}>{coordinates ? 'Refresh' : 'Capture'}</Text></TouchableOpacity></View>
              <Text style={styles.label}>Gate delay (seconds)</Text>
              <TextInput accessibilityLabel="Gate delay in seconds" keyboardType="numeric" onChangeText={setGateDelaySec} placeholder="0" placeholderTextColor={COLORS.muted} style={styles.input} value={gateDelaySec} />
              <Text style={styles.label}>Walk from gate (metres)</Text>
              <TextInput accessibilityLabel="Walk distance in metres" keyboardType="numeric" onChangeText={setCompoundWalkMeters} placeholder="0" placeholderTextColor={COLORS.muted} style={styles.input} value={compoundWalkMeters} />
              <Text style={styles.label}>Access note</Text>
              <TextInput accessibilityLabel="Building access note" multiline onChangeText={setAccessNotes} placeholder="What should the next visitor know?" placeholderTextColor={COLORS.muted} style={[styles.input, styles.noteInput]} textAlignVertical="top" value={accessNotes} />
              <TouchableOpacity accessibilityRole="checkbox" accessibilityState={{ checked: hasConsent }} onPress={() => setHasConsent((value) => !value)} style={styles.consentRow}>
                <View style={[styles.checkbox, hasConsent && styles.checkboxChecked]}>{hasConsent && <Text style={styles.check}>✓</Text>}</View>
                <Text style={styles.consentText}>I have obtained consent to record this visit location for service verification.</Text>
              </TouchableOpacity>
              <TouchableOpacity disabled={isWorking} onPress={submitEvidence} style={[styles.primaryButton, isWorking && styles.buttonDisabled]}>
                {isWorking ? <ActivityIndicator color="#fffdf8" /> : <Text style={styles.primaryButtonText}>Submit field evidence</Text>}
              </TouchableOpacity>
              <Text style={styles.statusNote}>{notice}</Text>
            </View>
            <Text style={styles.footerNote}>If sending fails, the app keeps the record only while it remains open. Do not close it before retrying.</Text>
          </>
        )}

        {screen === 'account' && (
          <>
            <Text style={styles.eyebrow}>FIELD PROFILE</Text>
            <Text style={styles.pageTitle}>Your shift</Text>
            <View style={styles.card}>
              <Text style={styles.agentName}>{fieldSession.agent.display_name}</Text>
              <Text style={styles.agentId}>{fieldSession.agent.agent_id}</Text>
              <View style={styles.profileRule} />
              <Text style={styles.helper}>Evidence is signed with this field identity. Never share this device session.</Text>
              <TouchableOpacity onPress={() => { setFieldSession(null); setScreen('home'); setNotice('Signed out.'); }} style={styles.signOutButton}><Text style={styles.signOutText}>Sign out</Text></TouchableOpacity>
            </View>
          </>
        )}
      </ScrollView>
      <View style={styles.nav}>
        {([['home', 'Visit'], ['capture', 'Evidence'], ['account', 'Account']] as [Screen, string][]).map(([id, label]) => <TouchableOpacity key={id} onPress={() => setScreen(id)} style={styles.navItem}><View style={[styles.navDot, screen === id && styles.navDotActive]} /><Text style={[styles.navText, screen === id && styles.navTextActive]}>{label}</Text></TouchableOpacity>)}
      </View>
    </SafeAreaView>
  );
}

const COLORS = {
  ink: '#17211e',
  muted: '#78817c',
  forest: '#075d48',
  forestDark: '#064334',
  cream: '#f7f4ed',
  paper: '#fffdf8',
  line: '#e2ddd2',
  softGreen: '#e4f1e9',
  warning: '#9a4d22',
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.cream },
  scroll: { paddingHorizontal: 20, paddingTop: 18, paddingBottom: 32 },
  authScroll: { flexGrow: 1, padding: 24, paddingTop: 26, justifyContent: 'center' },
  appHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 20, paddingTop: 14, paddingBottom: 12, borderBottomWidth: 1, borderBottomColor: COLORS.line, backgroundColor: COLORS.paper },
  brandRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  mark: { width: 30, height: 30, borderRadius: 7, backgroundColor: COLORS.forestDark, alignItems: 'center', justifyContent: 'center' },
  markText: { color: '#fffdf8', fontWeight: '800', fontSize: 11 },
  brand: { color: COLORS.ink, fontSize: 17, fontWeight: '800', letterSpacing: -0.3 },
  brandSub: { color: COLORS.muted, fontSize: 9, fontWeight: '700', letterSpacing: 2, marginTop: 1 },
  onlineChip: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: COLORS.softGreen, paddingHorizontal: 10, paddingVertical: 7, borderRadius: 99 },
  onlineDot: { width: 6, height: 6, borderRadius: 6, backgroundColor: '#19905e' },
  onlineText: { color: COLORS.forestDark, fontWeight: '700', fontSize: 12 },
  authHero: { marginTop: 48, marginBottom: 30 },
  eyebrow: { color: COLORS.forest, fontSize: 11, fontWeight: '800', letterSpacing: 1.5, marginBottom: 9 },
  authTitle: { color: COLORS.ink, fontSize: 34, lineHeight: 39, fontWeight: '800', letterSpacing: -1 },
  authCopy: { color: '#5d6762', fontSize: 15, lineHeight: 22, marginTop: 14 },
  pageTitle: { color: COLORS.ink, fontSize: 27, letterSpacing: -0.7, fontWeight: '800', lineHeight: 33 },
  pageCopy: { color: '#5d6762', fontSize: 14, lineHeight: 21, marginTop: 8, marginBottom: 20 },
  card: { backgroundColor: COLORS.paper, borderWidth: 1, borderColor: COLORS.line, borderRadius: 16, padding: 18, shadowColor: '#514e46', shadowOpacity: 0.05, shadowRadius: 8, shadowOffset: { width: 0, height: 3 }, elevation: 1 },
  cardHeading: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  cardTitle: { color: COLORS.ink, fontSize: 18, fontWeight: '800', letterSpacing: -0.25 },
  step: { color: COLORS.forest, fontFamily: 'monospace', fontSize: 13 },
  helper: { color: '#67716b', fontSize: 13, lineHeight: 19, marginTop: 7 },
  label: { color: '#59645e', fontSize: 11, fontWeight: '800', letterSpacing: 0.8, marginTop: 18, marginBottom: 7 },
  input: { color: COLORS.ink, backgroundColor: '#fcfaf5', borderColor: '#d9d4c9', borderWidth: 1, borderRadius: 10, fontSize: 15, minHeight: 46, paddingHorizontal: 13, paddingVertical: 10 },
  noteInput: { minHeight: 86 },
  primaryButton: { alignItems: 'center', backgroundColor: COLORS.forestDark, borderRadius: 10, justifyContent: 'center', minHeight: 48, marginTop: 18, paddingHorizontal: 14 },
  primaryButtonText: { color: '#fffdf8', fontSize: 14, fontWeight: '800' },
  secondaryButton: { borderColor: '#b8cec3', borderWidth: 1, borderRadius: 10, alignItems: 'center', minHeight: 44, justifyContent: 'center', marginTop: 10 },
  secondaryButtonText: { color: COLORS.forestDark, fontSize: 14, fontWeight: '800' },
  buttonDisabled: { opacity: 0.65 },
  statusNote: { color: '#68736d', fontSize: 12, lineHeight: 18, marginTop: 13 },
  footerNote: { color: '#7a817d', fontSize: 11, lineHeight: 16, textAlign: 'center', marginTop: 20 },
  divider: { flexDirection: 'row', alignItems: 'center', gap: 9, marginTop: 18, marginBottom: -2 },
  dividerText: { color: '#959d97', fontSize: 10, fontWeight: '800', letterSpacing: 1 },
  resolvedCard: { backgroundColor: COLORS.softGreen, borderColor: '#c6dfd0', borderWidth: 1, borderRadius: 14, padding: 16, marginTop: 14 },
  sourceRow: { flexDirection: 'row', justifyContent: 'space-between', gap: 8 },
  sourceLabel: { color: COLORS.forest, fontSize: 11, fontWeight: '800', letterSpacing: 0.35 },
  confidence: { color: '#50705f', fontSize: 11, fontWeight: '700' },
  resolvedCode: { color: COLORS.ink, fontFamily: 'monospace', fontSize: 22, fontWeight: '800', letterSpacing: 1, marginTop: 12 },
  resolvedAddress: { color: '#42514a', fontSize: 13, lineHeight: 19, marginTop: 6 },
  warning: { color: COLORS.warning, fontSize: 12, lineHeight: 18, marginTop: 12 },
  queueCard: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', borderTopWidth: 1, borderTopColor: COLORS.line, marginTop: 24, paddingVertical: 18 },
  queueTitle: { color: COLORS.ink, fontSize: 14, fontWeight: '800' },
  queueCopy: { color: '#6f7873', fontSize: 12, marginTop: 4 },
  queueButton: { borderColor: COLORS.forest, borderWidth: 1, borderRadius: 8, paddingHorizontal: 12, paddingVertical: 8 },
  queueButtonText: { color: COLORS.forest, fontSize: 12, fontWeight: '800' },
  captureTop: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 17 },
  textButton: { color: COLORS.forest, fontWeight: '800', fontSize: 13, paddingTop: 5 },
  visitCard: { backgroundColor: COLORS.ink, borderRadius: 15, padding: 17, marginBottom: 15 },
  visitCode: { color: '#fffdf8', fontFamily: 'monospace', fontSize: 22, fontWeight: '800', letterSpacing: 0.8 },
  visitAddress: { color: '#c9d0cb', fontSize: 13, marginTop: 7, lineHeight: 18 },
  gpsRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', borderColor: '#d9d4c9', borderWidth: 1, backgroundColor: '#fcfaf5', borderRadius: 10, padding: 12 },
  gpsTitle: { color: COLORS.ink, fontSize: 13, fontWeight: '700' },
  gpsMeta: { color: COLORS.muted, fontFamily: 'monospace', fontSize: 10, marginTop: 4 },
  locationButton: { borderRadius: 7, paddingHorizontal: 10, paddingVertical: 8, backgroundColor: '#e4eee8' },
  locationButtonText: { color: COLORS.forestDark, fontWeight: '800', fontSize: 12 },
  consentRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, marginTop: 18 },
  checkbox: { width: 21, height: 21, borderWidth: 1, borderColor: '#aeb8b0', borderRadius: 5, alignItems: 'center', justifyContent: 'center', marginTop: 1 },
  checkboxChecked: { backgroundColor: COLORS.forest, borderColor: COLORS.forest },
  check: { color: '#fff', fontSize: 13, fontWeight: '900' },
  consentText: { color: '#55615a', fontSize: 12, lineHeight: 18, flex: 1 },
  agentName: { color: COLORS.ink, fontSize: 22, fontWeight: '800' },
  agentId: { color: COLORS.muted, fontFamily: 'monospace', fontSize: 12, marginTop: 5 },
  profileRule: { height: 1, backgroundColor: COLORS.line, marginVertical: 18 },
  signOutButton: { borderColor: '#d8b8aa', borderWidth: 1, alignItems: 'center', paddingVertical: 11, borderRadius: 9, marginTop: 22 },
  signOutText: { color: '#99492d', fontWeight: '800', fontSize: 13 },
  nav: { backgroundColor: COLORS.paper, borderTopColor: COLORS.line, borderTopWidth: 1, flexDirection: 'row', justifyContent: 'space-around', paddingTop: 10, paddingBottom: 12 },
  navItem: { alignItems: 'center', gap: 4, minWidth: 68 },
  navDot: { height: 4, width: 4, borderRadius: 4, backgroundColor: 'transparent' },
  navDotActive: { backgroundColor: COLORS.forest },
  navText: { color: '#808983', fontSize: 11, fontWeight: '700' },
  navTextActive: { color: COLORS.forestDark },
});
