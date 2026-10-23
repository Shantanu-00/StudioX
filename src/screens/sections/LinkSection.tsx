import React, {useEffect, useState} from 'react';
import {StyleSheet, Text, View} from 'react-native';
import {FocusFrame} from '../../components/FocusFrame';
import {QrGlyph} from '../../components/QrGlyph';
import {useLink} from '../../hooks/useLink';
import {LinkPairingState, useLinkPairing} from '../../hooks/useLinkPairing';
import {colors, numeric, space, type} from '../../theme';

const QR = 208;

// "Sign in on your phone" layout used by TV apps: the code on the left, the
// steps and a typed fallback on the right. Pairing runs on the AWS API
// (POST /v1/pairings, then polling); the QR encodes the URL it returns.
export const LinkSection = () => {
  const {state, retry} = useLinkPairing();
  const link = useLink();
  const waiting = state.phase === 'live' && state.status === 'waiting';

  return (
    <View style={styles.root}>
      <Text style={styles.pageTitle}>Link a phone</Text>
      <View style={styles.columns}>
        <View style={styles.plateCard}>
          {state.phase === 'live' ? (
            <View style={[styles.plate, !waiting && styles.plateSpent]}>
              <QrGlyph value={state.pairing.url} size={QR} />
            </View>
          ) : null}
          {state.phase === 'live' && state.status === 'linked' ? (
            <View style={styles.plateOverlay} pointerEvents="none">
              <Text style={styles.plateLinked}>Linked</Text>
            </View>
          ) : null}
          {state.phase === 'live' ? null : (
            <View style={[styles.plate, styles.platePending]}>
              <Text style={styles.plateNote}>
                {state.phase === 'creating' ? 'Making a code…' : 'No code'}
              </Text>
            </View>
          )}
        </View>

        <View style={styles.side}>
          {[
            'Point your phone camera at the code.',
            'Open the StudioX Link page it shows. Nothing to install.',
            'Ask about what is playing. Cards you send from the TV land there.',
          ].map((step, i) => (
            <View key={step} style={styles.step}>
              <View style={styles.stepNum}>
                <Text style={styles.stepNumText}>{i + 1}</Text>
              </View>
              <Text style={styles.stepText}>{step}</Text>
            </View>
          ))}

          {state.phase === 'live' && waiting && (
            <View style={styles.fallback}>
              <Text style={styles.fallbackLabel} numberOfLines={1}>
                {`Or open ${host(state.pairing.url)}/link and enter`}
              </Text>
              <Text style={styles.code}>{formatCode(state.pairing.code)}</Text>
            </View>
          )}

          <Status state={state} />

          {link && !(state.phase === 'live' && state.status === 'linked') ? (
            <Text style={styles.linked} numberOfLines={1}>
              {`Already linked: ${link.phoneName}`}
            </Text>
          ) : null}

          <FocusFrame
            testID="link-new-code"
            accessibilityLabel="Get a new code"
            variant="button"
            hasTVPreferredFocus
            style={styles.buttonWrap}
            contentStyle={styles.button}
            onPress={retry}>
            {(focused) => (
              <Text
                style={[
                  styles.buttonText,
                  focused && styles.buttonTextFocused,
                ]}>
                Get a new code
              </Text>
            )}
          </FocusFrame>
        </View>
      </View>
    </View>
  );
};

const host = (url: string) => url.replace(/^https?:\/\//, '').split('/')[0];
// Shown 3-3 like the phone app (K7Q-4XZ); typed without the dash.
const formatCode = (code: string) => `${code.slice(0, 3)}-${code.slice(3)}`;

const Status = ({state}: {state: LinkPairingState}) => {
  let text = 'Making a code…';
  let detail: string | undefined;
  let tone: 'idle' | 'live' | 'alert' = 'idle';
  if (state.phase === 'error') {
    text = 'Can’t reach StudioX';
    detail = `The StudioX service did not answer (${state.message}). Check the network, then get a new code.`;
    tone = 'alert';
  } else if (state.phase === 'live') {
    switch (state.status) {
      case 'waiting':
        text = 'Waiting for your phone';
        break;
      case 'linked':
        text = `Linked to ${state.phoneName ?? 'your phone'}`;
        detail = 'Pause an episode and ask, or send a card to the phone.';
        tone = 'live';
        break;
      case 'expired':
        text = 'This code has expired';
        detail = 'Codes last ten minutes. Get a new one.';
        tone = 'alert';
        break;
    }
  }
  return (
    <View style={styles.status} accessible accessibilityLiveRegion="polite">
      <View style={styles.statusRow}>
        <View
          style={[
            styles.dot,
            tone === 'live' && styles.dotLive,
            tone === 'alert' && styles.dotAlert,
          ]}
        />
        <Text style={styles.statusText} numberOfLines={1}>
          {text}
        </Text>
        {state.phase === 'live' && state.status === 'waiting' && (
          <Countdown expiresAt={state.pairing.expiresAt} />
        )}
      </View>
      {detail ? (
        <Text style={styles.statusDetail} numberOfLines={2}>
          {detail}
        </Text>
      ) : null}
    </View>
  );
};

// Owns its one-second timer so the QR does not re-render every second.
const Countdown = ({expiresAt}: {expiresAt: number}) => {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);
  const left = Math.max(0, Math.round((expiresAt - now) / 1000));
  return (
    <Text style={styles.countdown}>
      {String(Math.floor(left / 60)).padStart(2, '0')}:
      {String(left % 60).padStart(2, '0')}
    </Text>
  );
};

const styles = StyleSheet.create({
  root: {
    flex: 1,
    paddingLeft: space.content,
    paddingRight: space.safeX,
    paddingTop: space.safeY + 18,
  },
  pageTitle: {...type.title, color: colors.text},
  columns: {flexDirection: 'row', marginTop: 36},
  plateCard: {padding: space.m, backgroundColor: colors.plate, borderRadius: 12},
  plate: {width: QR, height: QR, overflow: 'hidden'},
  plateSpent: {opacity: 0.12},
  platePending: {alignItems: 'center', justifyContent: 'center'},
  plateNote: {...type.body, color: colors.ink},
  plateOverlay: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
  },
  plateLinked: {...type.title, color: colors.ink},
  side: {flex: 1, marginLeft: 44, paddingTop: 4},
  step: {flexDirection: 'row', alignItems: 'center', marginBottom: 14},
  stepNum: {
    width: 26,
    height: 26,
    borderRadius: 13,
    backgroundColor: colors.card,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  stepNumText: {...type.captionStrong, color: colors.text},
  stepText: {...type.body, color: colors.text, flex: 1},
  fallback: {marginTop: 6},
  fallbackLabel: {...type.body, color: colors.textSecondary},
  code: {...type.title, ...numeric, color: colors.text, marginTop: 4},
  status: {marginTop: 16},
  statusRow: {flexDirection: 'row', alignItems: 'center'},
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: colors.textTertiary,
    marginRight: 10,
  },
  dotLive: {backgroundColor: colors.text},
  dotAlert: {backgroundColor: colors.textSecondary},
  statusText: {...type.bodyStrong, color: colors.text, flexShrink: 1},
  linked: {...type.caption, color: colors.textSecondary, marginTop: 10, marginLeft: 18},
  countdown: {
    ...type.caption,
    color: colors.textTertiary,
    ...numeric,
    marginLeft: 10,
  },
  statusDetail: {
    ...type.caption,
    color: colors.textSecondary,
    marginTop: 4,
    marginLeft: 18,
  },
  buttonWrap: {alignSelf: 'flex-start', marginTop: 20},
  button: {height: 40, paddingHorizontal: space.m, justifyContent: 'center'},
  buttonText: {...type.bodyStrong, color: colors.text},
  buttonTextFocused: {color: colors.onFocus},
});
