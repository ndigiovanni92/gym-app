import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Animated,
  Modal,
  Pressable,
  SafeAreaView,
  StyleSheet,
  Text,
  TextInput,
  View,
  Vibration,
} from 'react-native';

import { supabase } from '@/src/lib/supabase';

type TemplateSet = {
  targetReps: string;
  restSeconds: number;
};

type SetLog = {
  setNumber: number;
  weight: number;
  reps: number;
};

type RestTimerScreenProps = {
  nextSetLabel: string;
  remainingSeconds: number;
  totalSeconds: number;
  paused: boolean;
  lastLog?: SetLog;
  restFinished: boolean;
  onAddRest: (seconds: number) => void;
  onSkipRest: () => void;
  onTogglePause: () => void;
  onStartNextSet: () => void;
};

type SetInputCardProps = {
  targetLine: string;
  lastLog?: SetLog;
  weight: number;
  reps: number;
  onChangeWeight: (value: number) => void;
  onChangeReps: (value: number) => void;
  onCompleteSet: () => void;
};

const TEMPLATE_SETS: TemplateSet[] = [
  { targetReps: '8–10', restSeconds: 90 },
  { targetReps: '8–10', restSeconds: 90 },
  { targetReps: '8–10', restSeconds: 90 },
  { targetReps: '8–10', restSeconds: 90 },
];

const EXERCISE_NAME = 'Incline DB Press';
const DEFAULT_PREFILL_FROM_LAST_SET = true;
const TIMER_ENDS_SHOWS_BUTTON = true;

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));

const formatSeconds = (total: number) => {
  const safe = Number.isFinite(total) ? Math.max(0, Math.floor(total)) : 0;
  const minutes = Math.floor(safe / 60);
  const seconds = safe % 60;
  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
};

const useSetRunnerData = (_templateId?: string) => {
  // Placeholder data source so we can swap in Supabase queries later.
  return useMemo(
    () => ({
      exerciseName: EXERCISE_NAME,
      templateSets: TEMPLATE_SETS,
    }),
    [],
  );
};

const useSetRunnerLogger = () => {
  const [logs, setLogs] = useState<SetLog[]>([]);

  const logSet = async (nextLog: SetLog) => {
    // Placeholder data layer; replace with Supabase insert when ready.
    setLogs((prev) => [...prev, nextLog]);
  };

  const resetLogs = () => setLogs([]);

  return { logs, logSet, resetLogs };
};

const SetInputCard = ({
  targetLine,
  lastLog,
  weight,
  reps,
  onChangeWeight,
  onChangeReps,
  onCompleteSet,
}: SetInputCardProps) => (
  <>
    <View style={styles.card}>
      <Text style={styles.cardTitle}>Target</Text>
      <Text style={styles.cardBig}>{targetLine}</Text>
      {lastLog ? (
        <Text style={styles.cardMuted}>
          Last set: {lastLog.weight} lbs × {lastLog.reps}
        </Text>
      ) : null}
    </View>
    <View style={styles.card}>
      <View style={styles.statsGrid}>
        <StatStepper
          label="Weight"
          value={weight}
          unit="lbs"
          onDec={() => onChangeWeight(clamp(weight - 5, 0, 500))}
          onInc={() => onChangeWeight(clamp(weight + 5, 0, 500))}
          onChangeValue={onChangeWeight}
        />
        <StatStepper
          label="Reps"
          value={reps}
          onDec={() => onChangeReps(clamp(reps - 1, 0, 100))}
          onInc={() => onChangeReps(clamp(reps + 1, 0, 100))}
          onChangeValue={onChangeReps}
        />
      </View>
    </View>
    <Pressable
      accessibilityRole="button"
      style={({ pressed }) => [styles.primaryBtn, pressed && styles.btnPressed]}
      onPress={onCompleteSet}
    >
      <Text style={styles.primaryBtnText}>Complete Set</Text>
    </Pressable>
  </>
);

const CompletedSetsList = ({ logs }: { logs: SetLog[] }) => {
  if (logs.length === 0) {
    return null;
  }

  return (
    <View style={[styles.card, styles.completedCard]}>
      <Text style={styles.cardTitle}>Completed</Text>
      <View style={styles.completedList}>
        {logs.map((log) => (
          <View key={log.setNumber} style={styles.logRow}>
            <Text style={styles.logLeft}>Set {log.setNumber}</Text>
            <Text style={styles.logRight}>
              {log.weight} × {log.reps}
            </Text>
          </View>
        ))}
      </View>
    </View>
  );
};

const BigTimer = ({
  remainingSeconds,
  totalSeconds,
  paused,
}: {
  remainingSeconds: number;
  totalSeconds: number;
  paused: boolean;
}) => {
  const pulse = useRef(new Animated.Value(0)).current;
  const progress = totalSeconds > 0 ? clamp(remainingSeconds / totalSeconds, 0, 1) : 0;
  const circleSize = 260;
  const strokeWidth = 10;
  const halfRotation = progress <= 0.5 ? progress * 360 : 180;
  const secondHalfRotation = progress > 0.5 ? (progress - 0.5) * 360 : 0;
  const showFirstHalf = progress > 0;
  const showSecondHalf = progress > 0.5;

  useEffect(() => {
    if (paused) {
      pulse.stopAnimation();
      pulse.setValue(0);
      return;
    }

    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 1, duration: 900, useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 0, duration: 900, useNativeDriver: true }),
      ]),
    );

    loop.start();
    return () => loop.stop();
  }, [paused, pulse]);

  const scale = pulse.interpolate({ inputRange: [0, 1], outputRange: [1, 1.05] });

  return (
    <View style={styles.timerWrap}>
      <Animated.View style={[styles.timerCircle, { transform: [{ scale }] }]}>
        <View
          style={[
            styles.timerRing,
            {
              width: circleSize,
              height: circleSize,
              borderRadius: circleSize / 2,
              borderWidth: strokeWidth,
            },
          ]}
        />
        <View style={[styles.timerProgressWrap, { width: circleSize, height: circleSize }]}>
          <View style={[styles.timerHalf, styles.timerHalfRight, !showFirstHalf && styles.hidden]}>
            <View
              style={[
                styles.timerProgress,
                styles.timerProgressRight,
                {
                  width: circleSize,
                  height: circleSize,
                  borderRadius: circleSize / 2,
                  transform: [{ rotateZ: `${halfRotation - 90}deg` }],
                },
              ]}
            />
          </View>
          <View style={[styles.timerHalf, !showSecondHalf && styles.hidden]}>
            <View
              style={[
                styles.timerProgress,
                styles.timerProgressLeft,
                {
                  width: circleSize,
                  height: circleSize,
                  borderRadius: circleSize / 2,
                  transform: [{ rotateZ: `${secondHalfRotation - 90}deg` }],
                },
              ]}
            />
          </View>
        </View>
        <View
          style={[
            styles.timerInner,
            {
              width: circleSize - strokeWidth * 2,
              height: circleSize - strokeWidth * 2,
              borderRadius: (circleSize - strokeWidth * 2) / 2,
            },
          ]}
        />
        <Text style={styles.timerText}>{formatSeconds(remainingSeconds)}</Text>
        <Text style={styles.timerHint}>{paused ? 'Paused' : 'Resting'}</Text>
      </Animated.View>
    </View>
  );
};

const RestTimerScreen = ({
  nextSetLabel,
  remainingSeconds,
  totalSeconds,
  paused,
  lastLog,
  restFinished,
  onAddRest,
  onSkipRest,
  onTogglePause,
  onStartNextSet,
}: RestTimerScreenProps) => (
  <SafeAreaView style={styles.restSafe}>
    <View style={styles.restContainer}>
      <View style={styles.restHeader}>
        <Text style={styles.restTitle}>Rest Break</Text>
        <Text style={styles.restSubtitle}>{nextSetLabel}</Text>
      </View>

      <View style={styles.restSpacer} />

      <BigTimer remainingSeconds={remainingSeconds} totalSeconds={totalSeconds} paused={paused} />

      {lastLog ? (
        <View style={styles.restMeta}>
          <Text style={styles.restMetaText}>
            Last set: {lastLog.weight} lbs × {lastLog.reps}
          </Text>
        </View>
      ) : null}

      <View style={styles.restActions}>
        <Pressable
          accessibilityRole="button"
          style={({ pressed }) => [styles.restChip, pressed && styles.btnPressed]}
          onPress={() => onAddRest(15)}
        >
          <Text style={styles.restChipText}>+15s</Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          style={({ pressed }) => [styles.restChip, pressed && styles.btnPressed]}
          onPress={() => onAddRest(30)}
        >
          <Text style={styles.restChipText}>+30s</Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          style={({ pressed }) => [styles.restChip, pressed && styles.btnPressed]}
          onPress={onSkipRest}
        >
          <Text style={styles.restChipText}>Skip</Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          style={({ pressed }) => [styles.restChip, pressed && styles.btnPressed]}
          onPress={onTogglePause}
        >
          <Text style={styles.restChipText}>{paused ? 'Resume' : 'Pause'}</Text>
        </Pressable>
      </View>

      <View style={styles.restFooterSpacer} />

      <Pressable
        accessibilityRole="button"
        style={({ pressed }) => [
          styles.restPrimaryBtn,
          pressed && styles.btnPressed,
          !restFinished && styles.primaryBtnDisabled,
        ]}
        disabled={!restFinished}
        onPress={onStartNextSet}
      >
        <Text style={styles.restPrimaryBtnText}>Start Next Set</Text>
      </Pressable>

      <View style={styles.restLinkSpacer} />
      <Pressable
        accessibilityRole="button"
        style={({ pressed }) => [styles.linkBtn, pressed && styles.btnPressed]}
        onPress={onStartNextSet}
      >
        <Text style={styles.restLinkText}>Go now (ignore rest)</Text>
      </Pressable>
    </View>
  </SafeAreaView>
);

const StatStepper = ({
  label,
  value,
  unit,
  onDec,
  onInc,
  onChangeValue,
}: {
  label: string;
  value: number;
  unit?: string;
  onDec: () => void;
  onInc: () => void;
  onChangeValue: (nextValue: number) => void;
}) => {
  const pop = useRef(new Animated.Value(0)).current;
  const [draftValue, setDraftValue] = useState(String(value));

  useEffect(() => {
    setDraftValue(String(value));
  }, [value]);

  const bump = () => {
    pop.stopAnimation();
    pop.setValue(0);
    Animated.sequence([
      Animated.timing(pop, { toValue: 1, duration: 90, useNativeDriver: true }),
      Animated.timing(pop, { toValue: 0, duration: 140, useNativeDriver: true }),
    ]).start();
  };

  const scale = pop.interpolate({ inputRange: [0, 1], outputRange: [1, 1.02] });

  return (
    <View style={styles.statWrap}>
      <Text style={styles.statLabel}>{label}</Text>
      <Animated.View style={[styles.statCircle, styles.statCircleBig, { transform: [{ scale }] }]}>
        <TextInput
          value={draftValue}
          onChangeText={(text) => {
            const cleaned = text.replace(/[^\d]/g, '');
            setDraftValue(cleaned);
            const numericValue = cleaned.length === 0 ? 0 : Number(cleaned);
            if (Number.isFinite(numericValue)) {
              onChangeValue(numericValue);
            }
          }}
          keyboardType="number-pad"
          inputMode="numeric"
          selectTextOnFocus
          style={styles.statInput}
        />
        {unit ? <Text style={styles.statUnit}>{unit}</Text> : null}
      </Animated.View>
      <View style={styles.statControls}>
        <Pressable
          accessibilityRole="button"
          style={({ pressed }) => [styles.statBtn, pressed && styles.btnPressed]}
          onPress={() => {
            bump();
            onDec();
          }}
        >
          <Text style={styles.statBtnText}>−</Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          style={({ pressed }) => [styles.statBtn, pressed && styles.btnPressed]}
          onPress={() => {
            bump();
            onInc();
          }}
        >
          <Text style={styles.statBtnText}>+</Text>
        </Pressable>
      </View>
    </View>
  );
};

export default function WorkoutTemplateScreen() {
  const params = useLocalSearchParams<{ templateId?: string | string[] }>();
  const templateId = Array.isArray(params.templateId) ? params.templateId[0] : params.templateId;
  const router = useRouter();
  const { exerciseName, templateSets } = useSetRunnerData(templateId);
  const { logs, logSet, resetLogs } = useSetRunnerLogger();

  const [mode, setMode] = useState<'lifting' | 'rest' | 'done'>('lifting');
  const [currentSetIndex, setCurrentSetIndex] = useState(0);
  const [weight, setWeight] = useState(70);
  const [reps, setReps] = useState(9);
  const [restRemaining, setRestRemaining] = useState(0);
  const [restTotal, setRestTotal] = useState(0);
  const [restPaused, setRestPaused] = useState(false);
  const [restFinished, setRestFinished] = useState(false);
  const [nextTemplateId, setNextTemplateId] = useState<string | null>(null);

  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const totalSets = templateSets.length;
  const isLastSet = currentSetIndex === totalSets - 1;
  const currentTemplateSet = templateSets[currentSetIndex];
  const lastLog = logs.at(-1);

  const targetLine = useMemo(() => {
    return `${currentTemplateSet?.targetReps ?? ''} reps`;
  }, [currentTemplateSet]);

  useEffect(() => {
    if (mode !== 'rest') {
      return;
    }

    if (intervalRef.current) {
      clearInterval(intervalRef.current);
    }

    intervalRef.current = setInterval(() => {
      setRestRemaining((prev) => {
        if (restPaused) {
          return prev;
        }
        return prev <= 1 ? 0 : prev - 1;
      });
    }, 1000);

    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
      }
      intervalRef.current = null;
    };
  }, [mode, restPaused]);

  useEffect(() => {
    if (mode !== 'rest' || restRemaining !== 0 || restFinished) {
      return;
    }

    setRestFinished(true);
    Vibration.vibrate(150);

    if (!TIMER_ENDS_SHOWS_BUTTON) {
      startNextSet();
    }
  }, [mode, restRemaining, restFinished]);

  useEffect(() => {
    let isMounted = true;

    const loadNextTemplate = async () => {
      if (!templateId) {
        if (isMounted) {
          setNextTemplateId(null);
        }
        return;
      }

      const { data: currentTemplate, error: templateError } = await supabase
        .from('workout_templates')
        .select('id, program_id')
        .eq('id', templateId)
        .maybeSingle();

      if (!isMounted || templateError || !currentTemplate?.program_id) {
        if (isMounted) {
          setNextTemplateId(null);
        }
        return;
      }

      const { data: templateList } = await supabase
        .from('workout_templates')
        .select('id')
        .eq('program_id', currentTemplate.program_id)
        .order('id', { ascending: true });

      if (!isMounted) {
        return;
      }

      const templates = (templateList ?? []) as { id: string }[];
      const currentIndex = templates.findIndex((template) => template.id === currentTemplate.id);
      const nextTemplate = currentIndex >= 0 ? templates[currentIndex + 1] : undefined;
      setNextTemplateId(nextTemplate?.id ?? null);
    };

    void loadNextTemplate();

    return () => {
      isMounted = false;
    };
  }, [templateId]);

  const prefillForNextSet = () => {
    if (!DEFAULT_PREFILL_FROM_LAST_SET || !lastLog) {
      return;
    }
    setWeight(lastLog.weight);
    setReps(lastLog.reps);
  };

  const completeSet = () => {
    if (reps <= 0 || weight < 0) {
      return;
    }

    void logSet({
      setNumber: currentSetIndex + 1,
      weight,
      reps,
    });

    if (isLastSet) {
      setMode('done');
      return;
    }

    setRestPaused(false);
    setRestFinished(false);
    const restSeconds = currentTemplateSet?.restSeconds ?? 90;
    setRestTotal(restSeconds);
    setRestRemaining(restSeconds);
    setMode('rest');
  };

  const startNextSet = () => {
    const nextIndex = currentSetIndex + 1;
    if (nextIndex >= totalSets) {
      setMode('done');
      return;
    }

    setCurrentSetIndex(nextIndex);
    prefillForNextSet();
    setRestRemaining(0);
    setRestTotal(0);
    setRestPaused(false);
    setRestFinished(false);
    setMode('lifting');
  };

  const addRest = (seconds: number) => {
    setRestRemaining((prev) => clamp(prev + seconds, 0, 60 * 60));
    setRestTotal((prev) => clamp(prev + seconds, 0, 60 * 60));
    setRestFinished(false);
  };

  const skipRest = () => {
    setRestRemaining(0);
  };

  const goToNextWorkout = () => {
    if (nextTemplateId) {
      router.replace({ pathname: '/workout/[templateId]', params: { templateId: nextTemplateId } });
      return;
    }

    resetLogs();
    router.replace('/(tabs)');
  };

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.container}>
        <View style={styles.header}>
          <View style={styles.headerText}>
            <Text style={styles.title}>{exerciseName}</Text>
            <Text style={styles.subtitle}>
              Set {currentSetIndex + 1} of {totalSets}
            </Text>
          </View>
          <View style={styles.badge}>
            <Text style={styles.badgeText}>{mode.toUpperCase()}</Text>
          </View>
        </View>

        {mode === 'done' ? (
          <View style={styles.card}>
            <Text style={styles.cardTitle}>Exercise Complete</Text>
            <Text style={styles.cardMuted}>Nice work. Here’s what you logged:</Text>
            <CompletedSetsList logs={logs} />
            <Pressable
              accessibilityRole="button"
              style={({ pressed }) => [styles.primaryBtn, pressed && styles.btnPressed]}
              onPress={goToNextWorkout}
            >
              <Text style={styles.primaryBtnText}>
                {nextTemplateId ? 'Next Workout' : 'Back to Today'}
              </Text>
            </Pressable>
          </View>
        ) : (
          <>
            <SetInputCard
              targetLine={targetLine}
              lastLog={lastLog}
              weight={weight}
              reps={reps}
              onChangeWeight={(value) => setWeight(clamp(value, 0, 500))}
              onChangeReps={(value) => setReps(clamp(value, 0, 100))}
              onCompleteSet={completeSet}
            />
            <CompletedSetsList logs={logs} />
          </>
        )}

        <Modal transparent={false} visible={mode === 'rest'} animationType="slide">
          <RestTimerScreen
            nextSetLabel={`Next: Set ${currentSetIndex + 2} of ${totalSets}`}
            remainingSeconds={restRemaining}
            totalSeconds={restTotal}
            paused={restPaused}
            lastLog={lastLog}
            restFinished={restFinished}
            onAddRest={addRest}
            onSkipRest={skipRest}
            onTogglePause={() => setRestPaused((prev) => !prev)}
            onStartNextSet={startNextSet}
          />
        </Modal>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#0B1220' },
  container: { flex: 1, padding: 16, gap: 12 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingBottom: 6,
  },
  headerText: { flex: 1 },
  title: { fontSize: 22, fontWeight: '900', color: '#FFFFFF' },
  subtitle: { fontSize: 14, color: 'rgba(255,255,255,0.75)', marginTop: 2 },
  badge: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: 'rgba(255,255,255,0.08)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.12)',
  },
  badgeText: { fontSize: 12, fontWeight: '900', color: 'rgba(255,255,255,0.85)' },
  card: {
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderRadius: 18,
    padding: 16,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.10)',
  },
  cardTitle: { fontSize: 13, fontWeight: '900', color: 'rgba(255,255,255,0.85)' },
  cardBig: { fontSize: 22, fontWeight: '900', color: '#FFFFFF', marginTop: 6 },
  cardMuted: { fontSize: 13, color: 'rgba(255,255,255,0.70)', marginTop: 6 },
  primaryBtn: {
    height: 52,
    borderRadius: 14,
    backgroundColor: '#16A34A',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 12,
  },
  primaryBtnDisabled: { opacity: 0.5 },
  primaryBtnText: { color: '#FFFFFF', fontSize: 16, fontWeight: '900' },
  logRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 6,
  },
  logLeft: { fontSize: 14, fontWeight: '900', color: 'rgba(255,255,255,0.75)' },
  logRight: { fontSize: 14, fontWeight: '900', color: '#FFFFFF' },
  completedCard: { paddingVertical: 12 },
  completedList: { marginTop: 8 },
  restSafe: { flex: 1, backgroundColor: '#0B1220' },
  restContainer: { flex: 1, padding: 20 },
  restHeader: { alignItems: 'center', paddingTop: 8 },
  restTitle: { fontSize: 20, fontWeight: '900', color: '#FFFFFF' },
  restSubtitle: {
    fontSize: 14,
    fontWeight: '700',
    color: 'rgba(255,255,255,0.75)',
    marginTop: 6,
  },
  restSpacer: { height: 24 },
  timerWrap: { alignItems: 'center', justifyContent: 'center' },
  timerCircle: {
    width: 260,
    height: 260,
    borderRadius: 130,
    alignItems: 'center',
    justifyContent: 'center',
    position: 'relative',
  },
  timerRing: {
    position: 'absolute',
    borderColor: 'rgba(255,255,255,0.14)',
  },
  timerProgressWrap: {
    position: 'absolute',
    overflow: 'hidden',
    borderRadius: 999,
  },
  timerHalf: {
    position: 'absolute',
    width: '50%',
    height: '100%',
    overflow: 'hidden',
    left: 0,
  },
  timerHalfRight: {
    right: 0,
    left: 'auto',
  },
  timerProgress: {
    position: 'absolute',
    backgroundColor: '#2563EB',
    top: 0,
  },
  timerProgressLeft: {
    left: 0,
  },
  timerProgressRight: {
    right: 0,
  },
  timerInner: {
    position: 'absolute',
    backgroundColor: '#0B1220',
  },
  hidden: {
    opacity: 0,
  },
  timerText: { fontSize: 56, fontWeight: '900', color: '#FFFFFF', textAlign: 'center' },
  timerHint: {
    fontSize: 14,
    fontWeight: '800',
    color: 'rgba(255,255,255,0.75)',
    marginTop: 6,
  },
  restMeta: {
    alignSelf: 'center',
    marginTop: 16,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 999,
    backgroundColor: 'rgba(255,255,255,0.08)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.12)',
  },
  restMetaText: { fontSize: 13, fontWeight: '800', color: 'rgba(255,255,255,0.85)' },
  restActions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
    justifyContent: 'center',
    marginTop: 18,
  },
  restChip: {
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 12,
    backgroundColor: 'rgba(255,255,255,0.08)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.12)',
  },
  restChipText: { fontSize: 14, fontWeight: '900', color: '#FFFFFF' },
  restFooterSpacer: { flex: 1 },
  restPrimaryBtn: {
    height: 56,
    borderRadius: 16,
    backgroundColor: '#2563EB',
    alignItems: 'center',
    justifyContent: 'center',
  },
  restPrimaryBtnText: { color: '#FFFFFF', fontSize: 16, fontWeight: '900' },
  restLinkText: { fontSize: 13, fontWeight: '900', color: 'rgba(255,255,255,0.85)' },
  restLinkSpacer: { height: 10 },
  linkBtn: {
    alignSelf: 'center',
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderRadius: 10,
  },
  statWrap: { alignItems: 'center', flex: 1 },
  statLabel: { fontSize: 13, fontWeight: '900', color: 'rgba(255,255,255,0.75)', marginBottom: 10 },
  statCircle: {
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 10,
    borderColor: 'rgba(255,255,255,0.10)',
    backgroundColor: 'rgba(255,255,255,0.04)',
  },
  statCircleBig: { width: 170, height: 170, borderRadius: 85 },
  statValue: { fontSize: 44, fontWeight: '900', color: '#FFFFFF' },
  statInput: {
    fontSize: 44,
    fontWeight: '900',
    color: '#FFFFFF',
    textAlign: 'center',
    minWidth: 90,
  },
  statUnit: { fontSize: 14, fontWeight: '900', color: 'rgba(255,255,255,0.65)', marginTop: 2 },
  statControls: { flexDirection: 'row', gap: 12, marginTop: 12 },
  statBtn: {
    width: 56,
    height: 44,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.08)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.12)',
  },
  statBtnText: { fontSize: 22, fontWeight: '900', color: '#FFFFFF' },
  statsGrid: { flexDirection: 'row', gap: 16, justifyContent: 'space-between' },
  btnPressed: { transform: [{ scale: 0.99 }], opacity: 0.95 },
});
