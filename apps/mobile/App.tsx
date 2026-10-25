import React, { useState } from 'react';
import {
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

export default function ResolveGridMobileApp() {
  const [mode, setMode] = useState<'kyc' | 'telemetry' | 'gate'>('kyc');
  const [agentId, setAgentId] = useState('agent_abj_01');
  const [applicantRef, setApplicantRef] = useState('MERCHANT-NG-88412');
  const [targetPostcode, setTargetPostcode] = useState('FC-02-A09-DB-09');
  const [fieldEmail, setFieldEmail] = useState('');
  const [fieldPassword, setFieldPassword] = useState('');
  const [fieldSession, setFieldSession] = useState<any>(null);
  const [gateDelaySec, setGateDelaySec] = useState('95');
  const [compoundWalkMeters, setCompoundWalkMeters] = useState('25');
  const [accessNotes, setAccessNotes] = useState(
    'Commercial riders sign security register at 2nd gate.'
  );

  const [gpsStatus, setGpsStatus] = useState<string>('Hardware GPS Ready');
  const [coords, setCoords] = useState<{
    latitude: number;
    longitude: number;
    accuracy: number;
    speedKmh: number;
  } | null>(null);
  const [serverResponse, setServerResponse] = useState<any>(null);

  const captureHardwareGps = async () => {
    setGpsStatus('Requesting High-Accuracy Hardware GPS...');
    const { status } = await Location.requestForegroundPermissionsAsync();
    if (status !== 'granted') {
      setGpsStatus('Location permission denied on device.');
      return null;
    }

    const pos = await Location.getCurrentPositionAsync({
      accuracy: Location.Accuracy.Highest,
    });

    const captured = {
      latitude: pos.coords.latitude,
      longitude: pos.coords.longitude,
      accuracy: Number((pos.coords.accuracy ?? 4.5).toFixed(1)),
      speedKmh: Number(Math.max(0, (pos.coords.speed ?? 0) * 3.6).toFixed(1)),
    };
    setCoords(captured);
    setGpsStatus(
      `Locked GPS: ${captured.latitude.toFixed(5)}, ${captured.longitude.toFixed(5)} (±${captured.accuracy}m)`
    );
    return captured;
  };

  const handleKycCheckIn = async () => {
    const c = await captureHardwareGps();
    if (!c) return;

    const res = await fetch(`${API_BASE}/v1/kyc/verify-location`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        applicant_ref: applicantRef,
        claimed_postcode: targetPostcode,
        latitude: c.latitude,
        longitude: c.longitude,
        gps_accuracy_m: c.accuracy,
      }),
    });
    setServerResponse(await res.json());
  };

  const handleTransmitTelemetryPing = async () => {
    const c = await captureHardwareGps();
    if (!c) return;

    const res = await fetch(`${API_BASE}/v1/telemetry/ping`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        agent_id: agentId,
        latitude: c.latitude,
        longitude: c.longitude,
        velocity_kmh: c.speedKmh || 30.0,
        telemetry_source: 'EXPO_MOBILE_HARDWARE_GPS',
      }),
    });
    setServerResponse(await res.json());
  };

  const handleSubmitGateTelemetry = async () => {
    if (!fieldSession?.access_token) {
      setGpsStatus('Sign in as a provisioned field agent before submitting evidence.');
      return;
    }
    const c = await captureHardwareGps();
    if (!c) return;

    const res = await fetch(`${API_BASE}/v1/field/observations`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${fieldSession.access_token}`,
      },
      body: JSON.stringify({
        agent_id: fieldSession.agent.agent_id,
        postcode: targetPostcode,
        latitude: c.latitude,
        longitude: c.longitude,
        gps_accuracy_m: c.accuracy,
        location_consent: true,
        gate_clearance_required: Number(gateDelaySec) >= 60,
        measured_gate_delay_sec: Number(gateDelaySec),
        compound_walk_meters: Number(compoundWalkMeters),
        building_access_notes: accessNotes,
      }),
    });
    setServerResponse(await res.json());
  };

  const handleFieldLogin = async () => {
    if (!fieldEmail.trim() || !fieldPassword) {
      setGpsStatus('Enter your field-agent email and password.');
      return;
    }
    const res = await fetch(`${API_BASE}/v1/field/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: fieldEmail.trim(), password: fieldPassword }),
    });
    const data = await res.json();
    if (!res.ok) {
      setGpsStatus(data.error || 'Unable to sign in.');
      return;
    }
    setFieldSession(data);
    setAgentId(data.agent.agent_id);
    setFieldPassword('');
    setGpsStatus(`Signed in as ${data.agent.display_name}. Field evidence is enabled.`);
  };

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView contentContainerStyle={styles.scroll}>
        <View style={styles.header}>
          <Text style={styles.brand}>ResolveGrid Field</Text>
          <Text style={styles.subtitle}>
            Official NIPOST Building Verification & Live Geofence Telemetry
          </Text>
          <Text style={styles.gpsBadge}>{gpsStatus}</Text>
        </View>

        <View style={styles.tabs}>
          {[
            { id: 'kyc', label: '1. KYC Building Pass' },
            { id: 'telemetry', label: '2. Courier GPS Ping' },
            { id: 'gate', label: '3. Gate Delay Log' },
          ].map((t) => (
            <TouchableOpacity
              key={t.id}
              onPress={() => setMode(t.id as any)}
              style={[styles.tabBtn, mode === t.id && styles.tabBtnActive]}
            >
              <Text style={[styles.tabText, mode === t.id && styles.tabTextActive]}>
                {t.label}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        {mode === 'kyc' && (
          <View style={styles.card}>
            <Text style={styles.cardTitle}>
              Mode 1: Instant NIPOST Building Capture & Signed KYC Pass
            </Text>
            <Text style={styles.label}>Merchant / Applicant Reference</Text>
            <TextInput
              style={styles.input}
              value={applicantRef}
              onChangeText={setApplicantRef}
            />
            <Text style={styles.label}>Claimed NIPOST 11-Char Postcode</Text>
            <TextInput
              style={styles.input}
              value={targetPostcode}
              onChangeText={setTargetPostcode}
            />
            <TouchableOpacity style={styles.primaryBtn} onPress={handleKycCheckIn}>
              <Text style={styles.primaryBtnText}>
                Capture Hardware GPS & Generate Signed KYC Pass
              </Text>
            </TouchableOpacity>
          </View>
        )}

        {mode === 'telemetry' && (
          <View style={styles.card}>
            <Text style={styles.cardTitle}>
              Mode 2: Live Courier Geofence Arrival & Online ML Trigger
            </Text>
            <Text style={styles.label}>Active Field Agent ID</Text>
            <TextInput style={styles.input} value={agentId} onChangeText={setAgentId} />
            <TouchableOpacity
              style={styles.primaryBtn}
              onPress={handleTransmitTelemetryPing}
            >
              <Text style={styles.primaryBtnText}>
                Stream Hardware GPS to Redis GEOADD & Verify Geofence
              </Text>
            </TouchableOpacity>
          </View>
        )}

        {mode === 'gate' && (
          <View style={styles.card}>
            <Text style={styles.cardTitle}>
              Mode 3: Audited Last-50-Metres Access Observation
            </Text>
            <Text style={styles.label}>NIPOST Building Postcode</Text>
            <TextInput
              style={styles.input}
              value={targetPostcode}
              onChangeText={setTargetPostcode}
            />
            {fieldSession ? (
              <View style={styles.authenticatedBanner}>
                <Text style={styles.authenticatedText}>
                  Signed in: {fieldSession.agent.display_name} ({fieldSession.agent.agent_id})
                </Text>
              </View>
            ) : (
              <View style={styles.signInCard}>
                <Text style={styles.cardTitle}>Field agent sign-in</Text>
                <Text style={styles.label}>Email</Text>
                <TextInput
                  style={styles.input}
                  value={fieldEmail}
                  onChangeText={setFieldEmail}
                  autoCapitalize="none"
                  keyboardType="email-address"
                />
                <Text style={styles.label}>Password</Text>
                <TextInput
                  style={styles.input}
                  value={fieldPassword}
                  onChangeText={setFieldPassword}
                  secureTextEntry
                  autoCapitalize="none"
                />
                <TouchableOpacity style={styles.secondaryBtn} onPress={handleFieldLogin}>
                  <Text style={styles.secondaryBtnText}>Sign In to Submit Evidence</Text>
                </TouchableOpacity>
              </View>
            )}
            <Text style={styles.label}>Measured Security Gate Delay (Seconds)</Text>
            <TextInput
              style={styles.input}
              value={gateDelaySec}
              onChangeText={setGateDelaySec}
              keyboardType="numeric"
            />
            <Text style={styles.label}>Compound Walk Distance (Metres)</Text>
            <TextInput
              style={styles.input}
              value={compoundWalkMeters}
              onChangeText={setCompoundWalkMeters}
              keyboardType="numeric"
            />
            <Text style={styles.label}>Gate & Compound Access Notes</Text>
            <TextInput
              style={styles.input}
              value={accessNotes}
              onChangeText={setAccessNotes}
            />
            <TouchableOpacity
              style={styles.primaryBtn}
              onPress={handleSubmitGateTelemetry}
            >
              <Text style={styles.primaryBtnText}>
                Capture GPS & Submit Audited Observation
              </Text>
            </TouchableOpacity>
          </View>
        )}

        {serverResponse && (
          <View style={styles.outputCard}>
            <Text style={styles.outputTitle}>Live Gateway Response</Text>
            <Text style={styles.outputJson}>
              {JSON.stringify(serverResponse, null, 2)}
            </Text>
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#070b14' },
  scroll: { padding: 18 },
  header: { marginBottom: 16 },
  brand: { fontSize: 24, fontWeight: '800', color: '#34d399' },
  subtitle: { fontSize: 13, color: '#94a3b8', marginTop: 4 },
  gpsBadge: {
    marginTop: 8,
    fontSize: 12,
    color: '#38bdf8',
    fontFamily: 'monospace',
  },
  tabs: { flexDirection: 'row', gap: 8, marginBottom: 16 },
  tabBtn: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: 8,
    backgroundColor: '#131c31',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#1e2d4a',
  },
  tabBtnActive: { borderColor: '#10b981', backgroundColor: '#0e2923' },
  tabText: { fontSize: 12, color: '#94a3b8', fontWeight: '600' },
  tabTextActive: { color: '#34d399' },
  card: {
    backgroundColor: '#0e1526',
    borderRadius: 12,
    padding: 16,
    borderWidth: 1,
    borderColor: '#1e2d4a',
  },
  cardTitle: { fontSize: 15, fontWeight: '700', color: '#f8fafc', marginBottom: 12 },
  label: { fontSize: 12, color: '#94a3b8', marginTop: 8, marginBottom: 4 },
  input: {
    backgroundColor: '#131c31',
    color: '#f8fafc',
    padding: 10,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#1e2d4a',
  },
  primaryBtn: {
    marginTop: 16,
    backgroundColor: '#10b981',
    paddingVertical: 13,
    borderRadius: 8,
    alignItems: 'center',
  },
  primaryBtnText: { color: '#04120c', fontWeight: '800', fontSize: 13 },
  secondaryBtn: {
    marginTop: 12,
    backgroundColor: '#1e40af',
    paddingVertical: 11,
    borderRadius: 8,
    alignItems: 'center',
  },
  secondaryBtnText: { color: '#dbeafe', fontWeight: '800', fontSize: 13 },
  signInCard: {
    marginTop: 8,
    padding: 12,
    borderRadius: 8,
    backgroundColor: '#0b1b36',
    borderWidth: 1,
    borderColor: '#1e3a8a',
  },
  authenticatedBanner: {
    marginTop: 8,
    padding: 10,
    borderRadius: 8,
    backgroundColor: '#0e2923',
    borderWidth: 1,
    borderColor: '#10b981',
  },
  authenticatedText: { color: '#6ee7b7', fontSize: 12, fontWeight: '700' },
  outputCard: {
    marginTop: 16,
    backgroundColor: '#090f1d',
    padding: 14,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#1e2d4a',
  },
  outputTitle: { color: '#38bdf8', fontWeight: '700', marginBottom: 6, fontSize: 12 },
  outputJson: { color: '#cbd5e1', fontFamily: 'monospace', fontSize: 11 },
});
