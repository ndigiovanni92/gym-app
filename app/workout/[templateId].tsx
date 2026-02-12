import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  Animated,
  ActivityIndicator,
  Modal,
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  Vibration,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import * as Haptics from 'expo-haptics';
import { Feather } from '@expo/vector-icons';

import { supabase } from '@/src/lib/supabase';

type TemplateSet = {
  targetReps: string;
  restSeconds: number;
};

type TemplateExercise = {
  id: string;
  exercise_id?: string | null;
  intent_blurb?: string | null;
  exercises?: {
    id: string;
    name?: string | null;
  } | null;
};

type WorkoutTemplateMeta = {
  notes?: string | null;
  target_duration_min?: number | null;
  program_id?: string | null;
  program_week?: number | null;
  workout_number?: number | null;
  week?: number | null;
  week_number?: number | null;
  day?: number | null;
  day_number?: number | null;
};

type SubstitutionOption = {
  id: string;
  substitute_exercise_id?: string | null;
  reason?: string | null;
  rank?: number | null;
  substitute?: {
    id: string;
    name?: string | null;
  } | null;
};

type SetLog = {
  localId: string;
  id?: string;
  setNumber: number;
  weight: number;
  reps: number;
  workoutSessionId?: string | null;
  exerciseId?: string | null;
};

type SetLogRow = {
  id: string;
  set_number: number;
  weight: number;
  reps: number;
  session_id?: string | null;
  exercise_id?: string | null;
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
  onCompleteSet: () => void | Promise<void>;
  onSkipExercise: () => void;
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
const INITIAL_WEIGHT = 70;
const INITIAL_REPS = 9;

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));

const formatSeconds = (total: number) => {
  const safe = Number.isFinite(total) ? Math.max(0, Math.floor(total)) : 0;
  const minutes = Math.floor(safe / 60);
  const seconds = safe % 60;
  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
};

const useSetRunnerLogger = () => {
  const [logs, setLogs] = useState<SetLog[]>([]);

  const logSet = async (nextLog: SetLog) => {
    if (!nextLog.workoutSessionId || !nextLog.exerciseId) {
      console.warn('Missing session/exercise for set log');
      return;
    }
    setLogs((prev) => [...prev, nextLog]);

    const payload: Record<string, number | string | boolean> = {
      set_number: nextLog.setNumber,
      weight: nextLog.weight,
      reps: nextLog.reps,
      is_bodyweight: false,
      was_pr: false,
      completed: true,
      logged_at: new Date().toISOString(),
    };

    if (nextLog.workoutSessionId) {
      payload.session_id = nextLog.workoutSessionId;
    }

    if (nextLog.exerciseId) {
      payload.exercise_id = nextLog.exerciseId;
    }

    const { data, error } = await supabase
      .from('set_logs')
      .insert(payload)
      .select('id')
      .maybeSingle();

    if (!error && data?.id) {
      setLogs((prev) =>
        prev.map((log) => (log.localId === nextLog.localId ? { ...log, id: data.id } : log)),
      );
    }
  };

  const updateLog = async (updatedLog: SetLog) => {
    setLogs((prev) =>
      prev.map((log) => (log.localId === updatedLog.localId ? updatedLog : log)),
    );

    if (!updatedLog.id) {
      return;
    }

    await supabase
      .from('set_logs')
      .update({ weight: updatedLog.weight, reps: updatedLog.reps })
      .eq('id', updatedLog.id);
  };

  const resetLogs = () => setLogs([]);

  const hydrateLogs = (nextLogs: SetLog[]) => setLogs(nextLogs);

  return { logs, logSet, updateLog, resetLogs, hydrateLogs };
};

const SetInputCard = ({
  targetLine,
  lastLog,
  weight,
  reps,
  onChangeWeight,
  onChangeReps,
  onCompleteSet,
  onSkipExercise,
}: SetInputCardProps) => {
  const pressAnim = useRef(new Animated.Value(0)).current;
  const [showRing, setShowRing] = useState(false);

  const pressIn = () => {
    Animated.timing(pressAnim, { toValue: 1, duration: 110, useNativeDriver: true }).start();
  };

  const pressOut = () => {
    Animated.timing(pressAnim, { toValue: 0, duration: 140, useNativeDriver: true }).start();
  };

  const handlePress = () => {
    setShowRing(true);
    setTimeout(() => setShowRing(false), 420);
    onCompleteSet();
  };

  const scale = pressAnim.interpolate({ inputRange: [0, 1], outputRange: [1, 0.98] });
  const translateY = pressAnim.interpolate({ inputRange: [0, 1], outputRange: [0, 2] });

  return (
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
      <Animated.View style={[styles.primaryBtnGlow, { transform: [{ scale }, { translateY }] }]}>
        <Pressable
          accessibilityRole="button"
          style={({ pressed }) => [styles.primaryBtn, pressed && styles.btnPressed]}
          onPressIn={pressIn}
          onPressOut={pressOut}
          onPress={handlePress}
        >
          <View style={styles.primaryBtnGradientTop} />
          <View style={styles.primaryBtnGradientBottom} />
          <View style={styles.primaryBtnContent}>
            <Text style={styles.primaryBtnText}>Complete Set</Text>
            {showRing ? <ActivityIndicator color="#FFFFFF" size="small" /> : null}
          </View>
          </Pressable>
        </Animated.View>
        <Pressable
          accessibilityRole="button"
          style={({ pressed }) => [styles.secondaryBtn, pressed && styles.btnPressed]}
          onPress={onSkipExercise}
        >
          <Text style={styles.secondaryBtnText}>Skip Exercise</Text>
        </Pressable>
      </>
    );
  };

const CompletedSetsList = ({
  logs,
  onEdit,
}: {
  logs: SetLog[];
  onEdit?: (log: SetLog) => void;
}) => {
  if (logs.length === 0) {
    return null;
  }

  return (
    <View style={[styles.card, styles.completedCard]}>
      <Text style={styles.cardTitle}>Completed</Text>
      <View style={styles.completedList}>
        {logs.map((log) => (
          <Pressable
            key={log.localId}
            style={({ pressed }) => [
              styles.logRow,
              onEdit && styles.logRowPressable,
              pressed && onEdit && styles.btnPressed,
            ]}
            onPress={onEdit ? () => onEdit(log) : undefined}
          >
            <Text style={styles.logLeft}>Set {log.setNumber}</Text>
            <View style={styles.logRightGroup}>
              <Text style={styles.logRight}>
                {log.weight} × {log.reps}
              </Text>
              {onEdit ? <Feather name="edit-2" size={14} color="rgba(255,255,255,0.7)" /> : null}
            </View>
          </Pressable>
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
  const progress =
    totalSeconds > 0 ? clamp(remainingSeconds / totalSeconds, 0, 1) : 0;
  const circleSize = 260;
  const strokeWidth = 10;
  const segmentCount = 120;
  const activeSegments = Math.round(segmentCount * progress);
  const segmentAngles = useMemo(
    () => Array.from({ length: segmentCount }, (_, index) => (360 / segmentCount) * index),
    [segmentCount],
  );

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
        <View style={[styles.timerSegmentsWrap, { width: circleSize, height: circleSize }]}>
          {segmentAngles.map((angle, index) => (
            <View
              key={`seg-${index}`}
              style={[
                styles.timerSegment,
                {
                  width: 4,
                  height: strokeWidth,
                  backgroundColor: index < activeSegments ? '#2563EB' : 'transparent',
                  top: circleSize / 2 - strokeWidth / 2,
                  left: circleSize / 2 - 2,
                  transform: [{ rotateZ: `${angle}deg` }, { translateY: -(circleSize / 2 - strokeWidth / 2) }],
                },
              ]}
            />
          ))}
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
        <Text style={styles.timerText}>
          {remainingSeconds === 0 ? 'Ready' : formatSeconds(remainingSeconds)}
        </Text>
        <Text style={styles.timerHint}>
          {paused ? 'Paused' : remainingSeconds === 0 ? "You're good to go" : 'Resting'}
        </Text>
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
}: RestTimerScreenProps) => {
  const [showOverflow, setShowOverflow] = useState(false);

  return (
    <SafeAreaView style={styles.restSafe}>
      <View style={styles.restContainer}>
        <View style={styles.restHeader}>
          <Text style={styles.restTitle}>Rest Break</Text>
          <Text style={styles.restSubtitle}>{nextSetLabel}</Text>
          {lastLog ? (
            <Text style={styles.restMetaText}>
              Previous set: {lastLog.weight} lbs × {lastLog.reps}
            </Text>
          ) : null}
        </View>

        <View style={styles.restSpacer} />

        <BigTimer remainingSeconds={remainingSeconds} totalSeconds={totalSeconds} paused={paused} />

        <View style={styles.restInlineActions}>
          <Pressable
            accessibilityRole="button"
            style={({ pressed }) => [styles.restInlineBtn, pressed && styles.btnPressed]}
            onPress={() => onAddRest(15)}
          >
            <Text style={styles.restInlineText}>+15s</Text>
          </Pressable>
          <Text style={styles.restInlineDot}>·</Text>
          <Pressable
            accessibilityRole="button"
            style={({ pressed }) => [styles.restInlineBtn, pressed && styles.btnPressed]}
            onPress={() => onAddRest(30)}
          >
            <Text style={styles.restInlineText}>+30s</Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            style={({ pressed }) => [styles.restInlineOverflow, pressed && styles.btnPressed]}
            onPress={() => setShowOverflow(true)}
          >
            <Text style={styles.restInlineOverflowText}>Adjust</Text>
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
          <Text style={styles.restLinkText}>Start now</Text>
        </Pressable>
      </View>
      <Modal transparent visible={showOverflow} animationType="fade">
        <View style={styles.editOverlay}>
          <View style={styles.editCard}>
            <Text style={styles.editTitle}>Rest Options</Text>
            <Pressable
              accessibilityRole="button"
              style={({ pressed }) => [styles.overflowAction, pressed && styles.btnPressed]}
              onPress={() => {
                setShowOverflow(false);
                onTogglePause();
              }}
            >
              <Text style={styles.overflowActionText}>{paused ? 'Resume' : 'Pause'}</Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              style={({ pressed }) => [styles.overflowAction, pressed && styles.btnPressed]}
              onPress={() => {
                setShowOverflow(false);
                onSkipRest();
              }}
            >
              <Text style={styles.overflowActionText}>Skip Rest</Text>
            </Pressable>
            <View style={styles.editActions}>
              <Pressable
                accessibilityRole="button"
                style={({ pressed }) => [styles.editBtn, pressed && styles.btnPressed]}
                onPress={() => setShowOverflow(false)}
              >
                <Text style={styles.editBtnText}>Close</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
};

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
  const didMountRef = useRef(false);

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

  useEffect(() => {
    if (!didMountRef.current) {
      didMountRef.current = true;
      return;
    }
    bump();
    void Haptics.selectionAsync();
  }, [value]);

  const scale = pop.interpolate({ inputRange: [0, 1], outputRange: [1, 1.02] });

  return (
    <View style={styles.statWrap}>
      <Text style={styles.statLabel}>{label}</Text>
      <Animated.View style={[styles.statCircle, styles.statCircleBig, { transform: [{ scale }] }]}>
        <TextInput
          value={draftValue}
          onChangeText={(text) => {
            const cleaned = text.replace(/[^\d]/g, '').slice(0, 3);
            setDraftValue(cleaned);
            const numericValue = cleaned.length === 0 ? 0 : Number(cleaned);
            if (Number.isFinite(numericValue)) {
              onChangeValue(numericValue);
            }
          }}
          maxLength={3}
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
            onDec();
          }}
        >
          <Text style={styles.statBtnText}>−</Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          style={({ pressed }) => [styles.statBtn, pressed && styles.btnPressed]}
          onPress={() => {
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
  const navigation = useNavigation();
  const { logs, logSet, updateLog, resetLogs, hydrateLogs } = useSetRunnerLogger();

  const [mode, setMode] = useState<'preview' | 'lifting' | 'rest' | 'done'>('preview');
  const [currentSetIndex, setCurrentSetIndex] = useState(0);
  const [weight, setWeight] = useState(INITIAL_WEIGHT);
  const [reps, setReps] = useState(INITIAL_REPS);
  const [restRemaining, setRestRemaining] = useState(0);
  const [restTotal, setRestTotal] = useState(0);
  const [restPaused, setRestPaused] = useState(false);
  const [restFinished, setRestFinished] = useState(false);
  const [templateExercises, setTemplateExercises] = useState<TemplateExercise[]>([]);
  const [currentExerciseIndex, setCurrentExerciseIndex] = useState(0);
  const [workoutSessionId, setWorkoutSessionId] = useState<string | null>(null);
  const [editingLog, setEditingLog] = useState<SetLog | null>(null);
  const [editWeight, setEditWeight] = useState('');
  const [editReps, setEditReps] = useState('');
  const [substitutionFor, setSubstitutionFor] = useState<TemplateExercise | null>(null);
  const [substitutionOptions, setSubstitutionOptions] = useState<SubstitutionOption[]>([]);
  const [substitutionLoading, setSubstitutionLoading] = useState(false);
  const [removeCandidate, setRemoveCandidate] = useState<TemplateExercise | null>(null);
  const [editSetsExercise, setEditSetsExercise] = useState<TemplateExercise | null>(null);
  const [editSetCount, setEditSetCount] = useState('');
  const [exerciseSetCounts, setExerciseSetCounts] = useState<Record<string, number>>({});
  const [showSkipConfirm, setShowSkipConfirm] = useState(false);
  const [workoutMeta, setWorkoutMeta] = useState<WorkoutTemplateMeta | null>(null);

  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const resumeAttemptedRef = useRef(false);
  const restTickedRef = useRef(false);

  const totalExercises = Math.max(templateExercises.length, 1);
  const isLastExercise = currentExerciseIndex >= totalExercises - 1;
  const currentExercise = templateExercises[currentExerciseIndex];
  const currentExerciseSetCount = currentExercise
    ? exerciseSetCounts[currentExercise.id] ?? TEMPLATE_SETS.length
    : TEMPLATE_SETS.length;
  const templateSets = TEMPLATE_SETS.slice(0, Math.max(1, currentExerciseSetCount));
  const totalSets = templateSets.length;
  const isLastSet = currentSetIndex === totalSets - 1;
  const currentTemplateSet = templateSets[currentSetIndex];
  const lastLog = logs.at(-1);
  const exerciseName = currentExercise?.exercises?.name ?? EXERCISE_NAME;
  const workoutNote = workoutMeta?.notes ?? null;
  const workoutDurationMinutes = workoutMeta?.target_duration_min ?? null;

  const targetLine = useMemo(() => {
    return `${currentTemplateSet?.targetReps ?? ''} reps`;
  }, [currentTemplateSet]);

  useLayoutEffect(() => {
    navigation.setOptions({
      headerLeft: () => (
        <Pressable
          accessibilityRole="button"
          style={({ pressed }) => [styles.headerBackBtn, pressed && styles.btnPressed]}
          onPress={() => {
            if (navigation.canGoBack()) {
              navigation.goBack();
              return;
            }
            router.replace('/(tabs)');
          }}
        >
          <Text style={styles.headerBackText}>Back</Text>
        </Pressable>
      ),
    });
  }, [navigation, router]);

  useEffect(() => {
    if (mode !== 'rest') {
      restTickedRef.current = false;
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
    void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    Vibration.vibrate(200);

    if (!TIMER_ENDS_SHOWS_BUTTON) {
      startNextSet();
    }
  }, [mode, restRemaining, restFinished]);

  useEffect(() => {
    if (mode !== 'rest' || restRemaining !== 30 || restTickedRef.current) {
      return;
    }
    restTickedRef.current = true;
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
  }, [mode, restRemaining]);

  useEffect(() => {
    let isMounted = true;

    const loadExercises = async () => {
      if (!templateId) {
        if (isMounted) {
          setTemplateExercises([]);
          setCurrentExerciseIndex(0);
        }
        return;
      }

      setTemplateExercises([]);
      setCurrentExerciseIndex(0);
      resetLogs();
      resumeAttemptedRef.current = false;
      setExerciseSetCounts({});
      setCurrentSetIndex(0);
      setWeight(INITIAL_WEIGHT);
      setReps(INITIAL_REPS);
      setRestRemaining(0);
      setRestTotal(0);
      setRestPaused(false);
      setRestFinished(false);
      setMode('preview');
      setWorkoutSessionId(null);
      setWorkoutMeta(null);

      const selectColumns = 'id, exercise_id, intent_blurb, exercises ( id, name )';

      const { data, error } = await supabase
        .from('workout_template_exercises')
        .select(selectColumns)
        .eq('template_id', templateId);

      if (!isMounted) {
        return;
      }

      if (!error) {
        setTemplateExercises((data as TemplateExercise[]) ?? []);
        return;
      }

      const { data: fallbackData } = await supabase
        .from('workout_template_exercises')
        .select(selectColumns)
        .eq('workout_template_id', templateId);

      if (!isMounted) {
        return;
      }

      setTemplateExercises((fallbackData as TemplateExercise[]) ?? []);
    };

    void loadExercises();

    return () => {
      isMounted = false;
    };
  }, [templateId]);

  useEffect(() => {
    let isMounted = true;

    const resumeActiveSession = async () => {
      if (!templateId || templateExercises.length === 0 || resumeAttemptedRef.current) {
        return;
      }
      resumeAttemptedRef.current = true;

      const { data: userData } = await supabase.auth.getUser();
      const userId = userData?.user?.id ?? null;
      if (!userId) {
        return;
      }

      const { data: activeProgram } = await supabase
        .from('user_programs')
        .select('id, program_id')
        .eq('active', true)
        .eq('user_id', userId)
        .maybeSingle();

      if (!activeProgram?.id) {
        return;
      }

      const { data: progressData } = await supabase
        .from('user_program_progress')
        .select('next_program_schedule_id')
        .eq('user_program_id', activeProgram.id)
        .maybeSingle();

      const nextScheduleId =
        (progressData as { next_program_schedule_id?: string | null } | null)
          ?.next_program_schedule_id ?? null;

      let sessionQuery = supabase
        .from('workout_sessions')
        .select('id, workout_template_id, program_schedule_id')
        .eq('user_program_id', activeProgram.id)
        .eq('status', 'in_progress')
        .is('completed_at', null)
        .order('started_at', { ascending: false })
        .limit(1);

      if (nextScheduleId) {
        sessionQuery = sessionQuery.eq('program_schedule_id', nextScheduleId);
      }

      const { data: sessionData } = await sessionQuery.maybeSingle();

      if (!isMounted || !sessionData?.id) {
        return;
      }

      if (sessionData.workout_template_id && sessionData.workout_template_id !== templateId) {
        return;
      }

      setWorkoutSessionId(sessionData.id);

      const { data: logsData } = await supabase
        .from('set_logs')
        .select('id, set_number, weight, reps, session_id, exercise_id')
        .eq('session_id', sessionData.id);

      if (!isMounted) {
        return;
      }

      const allLogs = (logsData as SetLogRow[] | null) ?? [];
      const totalSetsForExercise = templateSets.length;

      const exerciseMeta = templateExercises.map((exercise) => ({
        exercise,
        primaryIds: [exercise.exercise_id, exercise.exercises?.id].filter(
          (id): id is string => Boolean(id),
        ),
      }));

      let resumeIndex = exerciseMeta.findIndex(({ primaryIds }) => {
        if (primaryIds.length === 0) {
          return false;
        }
        const completed = allLogs.filter((log) => primaryIds.includes(log.exercise_id ?? ''));
        return completed.length < totalSetsForExercise;
      });

      if (resumeIndex < 0) {
        resumeIndex = Math.max(0, templateExercises.length - 1);
      }

      const currentExercise = exerciseMeta[resumeIndex];
      const currentExerciseLogs = allLogs
        .filter((log) => currentExercise?.primaryIds.includes(log.exercise_id ?? ''))
        .sort((a, b) => a.set_number - b.set_number)
        .map((log) => ({
          localId: log.id,
          id: log.id,
          setNumber: log.set_number,
          weight: log.weight,
          reps: log.reps,
          workoutSessionId: log.session_id ?? null,
          exerciseId: log.exercise_id ?? null,
        }));

      const currentSetIndex = Math.min(currentExerciseLogs.length, totalSetsForExercise - 1);
      setCurrentExerciseIndex(resumeIndex);
      setCurrentSetIndex(currentSetIndex);
      hydrateLogs(currentExerciseLogs);

      const lastLoggedSet = currentExerciseLogs.at(-1);
      if (lastLoggedSet) {
        setWeight(lastLoggedSet.weight);
        setReps(lastLoggedSet.reps);
      }

      if (currentExerciseLogs.length >= totalSetsForExercise && resumeIndex >= templateExercises.length - 1) {
        setMode('done');
        return;
      }

      setMode('lifting');
    };

    void resumeActiveSession();

    return () => {
      isMounted = false;
    };
  }, [templateExercises, templateId, templateSets.length, hydrateLogs]);

  useEffect(() => {
    let isMounted = true;

    const loadWorkoutMeta = async () => {
      if (!templateId) {
        if (isMounted) {
          setWorkoutMeta(null);
        }
        return;
      }

      const { data } = await supabase
        .from('workout_templates')
        .select(
          'notes, target_duration_min, program_id, program_week, workout_number, week, week_number, day, day_number',
        )
        .eq('id', templateId)
        .maybeSingle();

      if (isMounted) {
        setWorkoutMeta((data as WorkoutTemplateMeta) ?? null);
      }
    };

    void loadWorkoutMeta();

    return () => {
      isMounted = false;
    };
  }, [templateId]);

  const ensureWorkoutSession = async () => {
    if (workoutSessionId || !templateId) {
      return workoutSessionId;
    }

    const { data: userData } = await supabase.auth.getUser();
    const userId = userData?.user?.id ?? null;
    if (!userId) {
      console.warn('Unable to start workout session without user');
      return null;
    }

    const { data: activeProgram, error: activeProgramError } = await supabase
      .from('user_programs')
      .select('id, program_id')
      .eq('active', true)
      .eq('user_id', userId)
      .maybeSingle();

    if (activeProgramError || !activeProgram?.id || !activeProgram?.program_id) {
      console.warn('Unable to start workout session without active program');
      return null;
    }

    const { data: progressData } = await supabase
      .from('user_program_progress')
      .select('next_program_schedule_id')
      .eq('user_program_id', activeProgram.id)
      .maybeSingle();

    const nextScheduleId =
      (progressData as { next_program_schedule_id?: string | null } | null)
        ?.next_program_schedule_id ?? null;

    if (!nextScheduleId) {
      console.warn('Unable to start workout session without next schedule');
      return null;
    }

    const { data: scheduleData } = await supabase
      .from('program_schedule')
      .select('id, week_number, day_number, workout_template_id')
      .eq('id', nextScheduleId)
      .maybeSingle();

    if (!scheduleData?.workout_template_id) {
      console.warn('Unable to start workout session without schedule template');
      return null;
    }

    const { data, error } = await supabase
      .from('workout_sessions')
      .insert({
        user_id: userId,
        user_program_id: activeProgram.id,
        program_id: activeProgram.program_id,
        program_schedule_id: scheduleData.id,
        workout_template_id: scheduleData.workout_template_id,
        program_week: scheduleData.week_number ?? null,
        program_day: scheduleData.day_number ?? null,
        status: 'in_progress',
        started_at: new Date().toISOString(),
        session_date: new Date().toISOString().slice(0, 10),
      })
      .select('id')
      .maybeSingle();

    if (!error && data?.id) {
      setWorkoutSessionId(data.id);
      return data.id;
    }

    if (error) {
      console.warn('Failed to start workout session', error);
    }
    return null;
  };

  const prefillForNextSet = () => {
    if (!DEFAULT_PREFILL_FROM_LAST_SET || !lastLog) {
      return;
    }
    setWeight(lastLog.weight);
    setReps(lastLog.reps);
  };

  const completeSet = async () => {
    if (reps <= 0 || weight < 0) {
      return;
    }

    const sessionId = await ensureWorkoutSession();

    void logSet({
      localId: `${Date.now()}-${currentSetIndex}`,
      setNumber: currentSetIndex + 1,
      weight,
      reps,
      workoutSessionId: sessionId,
      exerciseId: currentExercise?.exercise_id ?? null,
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

  const resetForExercise = () => {
    resetLogs();
    setCurrentSetIndex(0);
    setWeight(INITIAL_WEIGHT);
    setReps(INITIAL_REPS);
    setRestRemaining(0);
    setRestTotal(0);
    setRestPaused(false);
    setRestFinished(false);
    setMode('lifting');
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

  const markWorkoutSessionComplete = async () => {
    const sessionId = workoutSessionId ?? (await ensureWorkoutSession());
    if (!sessionId) {
      return;
    }
    await supabase
      .from('workout_sessions')
      .update({ completed_at: new Date().toISOString(), status: 'completed' })
      .eq('id', sessionId);
  };

  const goToNextWorkout = () => {
    resetLogs();
    router.replace('/(tabs)');
  };

  const completeWorkout = async () => {
    await markWorkoutSessionComplete();
    resetLogs();
    router.replace('/(tabs)');
  };

  const goToNextExerciseOrWorkout = () => {
    if (!isLastExercise) {
      setCurrentExerciseIndex((prev) => prev + 1);
      resetForExercise();
      return;
    }

    goToNextWorkout();
  };

  const startWorkout = async () => {
    await ensureWorkoutSession();
    setMode('lifting');
  };

  const openSubstitutions = async (exercise: TemplateExercise) => {
    const primaryIds = [exercise.exercise_id, exercise.exercises?.id].filter(
      (id): id is string => Boolean(id),
    );
    if (primaryIds.length === 0) {
      return;
    }
    setSubstitutionFor(exercise);
    setSubstitutionOptions([]);
    setSubstitutionLoading(true);

    const { data } = await supabase
      .from('exercise_substitutions')
      .select('id, substitute_exercise_id, reason, rank')
      .in('primary_exercise_id', primaryIds)
      .order('rank', { ascending: true });

    const substitutions = (data as SubstitutionOption[]) ?? [];
    const substituteIds = substitutions
      .map((option) => option.substitute_exercise_id)
      .filter((id): id is string => Boolean(id));

    if (substituteIds.length === 0) {
      setSubstitutionOptions(substitutions);
      setSubstitutionLoading(false);
      return;
    }

    const { data: exercisesData } = await supabase
      .from('exercises')
      .select('id, name')
      .in('id', substituteIds);

    const exerciseMap = new Map(
      ((exercisesData ?? []) as { id: string; name?: string | null }[]).map((exercise) => [
        exercise.id,
        exercise,
      ]),
    );

    setSubstitutionOptions(
      substitutions.map((option) => ({
        ...option,
        substitute: option.substitute_exercise_id
          ? exerciseMap.get(option.substitute_exercise_id) ?? null
          : null,
      })),
    );
    setSubstitutionLoading(false);
  };

  const closeSubstitutions = () => {
    setSubstitutionFor(null);
    setSubstitutionOptions([]);
    setSubstitutionLoading(false);
  };

  const applySubstitution = (option: SubstitutionOption) => {
    if (!substitutionFor) {
      return;
    }
    setTemplateExercises((prev) =>
      prev.map((exercise) =>
        exercise.id === substitutionFor.id
          ? {
              ...exercise,
              exercise_id: option.substitute_exercise_id ?? exercise.exercise_id,
              exercises: option.substitute ?? exercise.exercises,
            }
          : exercise,
      ),
    );
    closeSubstitutions();
  };

  const openEditSets = (exercise: TemplateExercise) => {
    if (mode !== 'preview') {
      return;
    }
    setEditSetsExercise(exercise);
    const currentCount = exerciseSetCounts[exercise.id] ?? TEMPLATE_SETS.length;
    setEditSetCount(String(currentCount));
  };

  const closeEditSets = () => {
    setEditSetsExercise(null);
    setEditSetCount('');
  };

  const saveEditSets = () => {
    if (!editSetsExercise) {
      return;
    }
    const parsed = Number(editSetCount);
    if (!Number.isFinite(parsed)) {
      return;
    }
    const nextCount = clamp(Math.round(parsed), 1, TEMPLATE_SETS.length);
    setExerciseSetCounts((prev) => ({ ...prev, [editSetsExercise.id]: nextCount }));
    closeEditSets();
  };

  const openRemoveExercise = (exercise: TemplateExercise) => {
    setRemoveCandidate(exercise);
  };

  const closeRemoveExercise = () => {
    setRemoveCandidate(null);
  };

  const confirmRemoveExercise = () => {
    if (!removeCandidate) {
      return;
    }

    setTemplateExercises((prev) => {
      if (prev.length <= 1) {
        return prev;
      }
      const next = prev.filter((exercise) => exercise.id !== removeCandidate.id);
      if (next.length === 0) {
        return prev;
      }
      setCurrentExerciseIndex((current) => Math.min(current, next.length - 1));
      return next;
    });
    closeRemoveExercise();
  };

  const startEditLog = (log: SetLog) => {
    setEditingLog(log);
    setEditWeight(String(log.weight));
    setEditReps(String(log.reps));
  };

  const confirmSkipExercise = () => {
    setShowSkipConfirm(true);
  };

  const cancelSkipExercise = () => {
    setShowSkipConfirm(false);
  };

  const proceedSkipExercise = () => {
    setShowSkipConfirm(false);
    goToNextExerciseOrWorkout();
  };

  const cancelEdit = () => {
    setEditingLog(null);
    setEditWeight('');
    setEditReps('');
  };

  const saveEdit = () => {
    if (!editingLog) {
      return;
    }

    const nextWeight = Number(editWeight);
    const nextReps = Number(editReps);
    if (!Number.isFinite(nextWeight) || !Number.isFinite(nextReps)) {
      return;
    }

    const updatedLog: SetLog = {
      ...editingLog,
      weight: clamp(nextWeight, 0, 500),
      reps: clamp(nextReps, 0, 100),
    };

    void updateLog(updatedLog);
    cancelEdit();
  };

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.container}>
        <View style={styles.header}>
          <View style={styles.headerText}>
            <Text style={styles.title}>{mode === 'preview' ? 'Workout Preview' : exerciseName}</Text>
            {mode === 'preview' ? null : (
              <Text style={styles.exerciseProgress}>
                Exercise {currentExerciseIndex + 1} of {totalExercises}
              </Text>
            )}
            {mode === 'preview' || !currentExercise?.intent_blurb ? null : (
              <Text style={styles.exerciseBlurb}>{currentExercise.intent_blurb}</Text>
            )}
          </View>
          <View style={styles.badge}>
            <Text style={styles.badgeText}>{mode.toUpperCase()}</Text>
          </View>
        </View>
        {mode === 'preview' ? null : (
          <View style={styles.setProgress}>
            <View style={styles.setDots}>
              {Array.from({ length: totalSets }).map((_, index) => {
                const isComplete = index < currentSetIndex;
                const isCurrent = index === currentSetIndex;
                return (
                  <View
                    key={`set-dot-${index}`}
                    style={[
                      styles.setDot,
                      isComplete && styles.setDotComplete,
                      isCurrent && styles.setDotCurrent,
                    ]}
                  />
                );
              })}
            </View>
            <Text style={styles.setProgressText}>
              Set {currentSetIndex + 1} of {totalSets}
            </Text>
          </View>
        )}

        {mode === 'preview' ? (
          <View style={styles.previewShell}>
            <ScrollView
              contentContainerStyle={styles.previewScrollContent}
              showsVerticalScrollIndicator={false}
            >
              <View style={styles.previewCard}>
                <Text style={styles.previewTitle}>Today’s Workout</Text>
                {workoutDurationMinutes ? (
                  <Text style={styles.previewMeta}>Target {workoutDurationMinutes} min</Text>
                ) : null}
                {workoutNote ? (
                  <Text style={styles.previewNote}>{workoutNote}</Text>
                ) : null}
                <View style={styles.previewList}>
                  {templateExercises.map((exercise, index) => (
                    <View key={exercise.id} style={styles.previewRow}>
                      <View style={styles.previewRowText}>
                        <Text style={styles.previewName}>
                          {exercise.exercises?.name ?? `Exercise ${index + 1}`}
                        </Text>
                        <Text style={styles.previewMeta}>
                          {exerciseSetCounts[exercise.id] ?? TEMPLATE_SETS.length} sets
                        </Text>
                      </View>
                      <View style={styles.previewActions}>
                        <Pressable
                          accessibilityRole="button"
                          accessibilityLabel="Substitute exercise"
                          style={({ pressed }) => [
                            styles.previewSwapBtn,
                            pressed && styles.btnPressed,
                          ]}
                          onPress={() => void openSubstitutions(exercise)}
                        >
                          <Feather name="repeat" size={16} color="#FFFFFF" />
                        </Pressable>
                        {templateExercises.length > 1 ? (
                          <Pressable
                            accessibilityRole="button"
                            accessibilityLabel="Remove exercise"
                            style={({ pressed }) => [
                              styles.previewRemoveBtn,
                              pressed && styles.btnPressed,
                            ]}
                            onPress={() => openRemoveExercise(exercise)}
                          >
                            <Feather name="trash-2" size={16} color="#FFFFFF" />
                          </Pressable>
                        ) : null}
                        <Pressable
                          accessibilityRole="button"
                          accessibilityLabel="Edit sets"
                          style={({ pressed }) => [
                            styles.previewEditBtn,
                            pressed && styles.btnPressed,
                          ]}
                          onPress={() => openEditSets(exercise)}
                        >
                          <Feather name="edit-3" size={16} color="#FFFFFF" />
                        </Pressable>
                      </View>
                    </View>
                  ))}
                </View>
              </View>
            </ScrollView>
            <View style={styles.previewFooter}>
              <Pressable
                accessibilityRole="button"
                style={({ pressed }) => [styles.primaryBtn, pressed && styles.btnPressed]}
                onPress={() => void startWorkout()}
              >
                <Text style={styles.primaryBtnText}>Start Workout</Text>
              </Pressable>
            </View>
          </View>
        ) : mode === 'done' ? (
          <View style={styles.card}>
            <Text style={styles.cardTitle}>Exercise Complete</Text>
            <Text style={styles.cardMuted}>Nice work. Here’s what you logged:</Text>
            <CompletedSetsList logs={logs} onEdit={startEditLog} />
            <Pressable
              accessibilityRole="button"
              style={({ pressed }) => [styles.primaryBtn, pressed && styles.btnPressed]}
              onPress={isLastExercise ? completeWorkout : goToNextExerciseOrWorkout}
            >
              <Text style={styles.primaryBtnText}>
                {!isLastExercise ? 'Next Exercise' : 'Complete Workout'}
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
              onSkipExercise={confirmSkipExercise}
            />
            <CompletedSetsList logs={logs} onEdit={startEditLog} />
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
        <Modal transparent visible={!!substitutionFor} animationType="fade">
          <View style={styles.editOverlay}>
            <View style={styles.editCard}>
              <Text style={styles.editTitle}>Substitutions</Text>
              {substitutionLoading ? (
                <Text style={styles.cardMuted}>Loading options...</Text>
              ) : substitutionOptions.length === 0 ? (
                <Text style={styles.cardMuted}>No substitutions available.</Text>
              ) : (
                substitutionOptions.map((option) => (
                  <Pressable
                    key={option.id}
                    accessibilityRole="button"
                    style={({ pressed }) => [
                      styles.previewSwapOption,
                      pressed && styles.btnPressed,
                    ]}
                    onPress={() => applySubstitution(option)}
                  >
                    <Text style={styles.previewName}>
                      {option.substitute?.name ?? 'Swap exercise'}
                    </Text>
                    {option.reason ? (
                      <Text style={styles.previewMeta}>{option.reason}</Text>
                    ) : null}
                  </Pressable>
                ))
              )}
              <View style={styles.editActions}>
                <Pressable
                  accessibilityRole="button"
                  style={({ pressed }) => [styles.editBtn, pressed && styles.btnPressed]}
                  onPress={closeSubstitutions}
                >
                  <Text style={styles.editBtnText}>Close</Text>
                </Pressable>
              </View>
            </View>
          </View>
        </Modal>
        <Modal transparent visible={!!editingLog} animationType="fade">
          <View style={styles.editOverlay}>
            <View style={styles.editCard}>
              <Text style={styles.editTitle}>Edit Set</Text>
              <View style={styles.editField}>
                <Text style={styles.editLabel}>Weight</Text>
                <TextInput
                  value={editWeight}
                  onChangeText={(text) =>
                    setEditWeight(text.replace(/[^\d]/g, '').slice(0, 3))
                  }
                  maxLength={3}
                  keyboardType="number-pad"
                  inputMode="numeric"
                  style={styles.editInput}
                />
              </View>
              <View style={styles.editField}>
                <Text style={styles.editLabel}>Reps</Text>
                <TextInput
                  value={editReps}
                  onChangeText={(text) => setEditReps(text.replace(/[^\d]/g, '').slice(0, 3))}
                  maxLength={3}
                  keyboardType="number-pad"
                  inputMode="numeric"
                  style={styles.editInput}
                />
              </View>
              <View style={styles.editActions}>
                <Pressable
                  accessibilityRole="button"
                  style={({ pressed }) => [styles.editBtn, pressed && styles.btnPressed]}
                  onPress={cancelEdit}
                >
                  <Text style={styles.editBtnText}>Cancel</Text>
                </Pressable>
                <Pressable
                  accessibilityRole="button"
                  style={({ pressed }) => [
                    styles.editBtn,
                    styles.editBtnPrimary,
                    pressed && styles.btnPressed,
                  ]}
                  onPress={saveEdit}
                >
                  <Text style={styles.editBtnText}>Save</Text>
                </Pressable>
              </View>
            </View>
          </View>
        </Modal>
        <Modal transparent visible={showSkipConfirm} animationType="fade">
          <View style={styles.editOverlay}>
            <View style={styles.editCard}>
              <Text style={styles.editTitle}>Skip exercise?</Text>
              <Text style={styles.cardMuted}>
                You’ll move to the next exercise without finishing all sets.
              </Text>
              <View style={styles.editActions}>
                <Pressable
                  accessibilityRole="button"
                  style={({ pressed }) => [styles.editBtn, pressed && styles.btnPressed]}
                  onPress={cancelSkipExercise}
                >
                  <Text style={styles.editBtnText}>Cancel</Text>
                </Pressable>
                <Pressable
                  accessibilityRole="button"
                  style={({ pressed }) => [
                    styles.editBtn,
                    styles.editBtnPrimary,
                    pressed && styles.btnPressed,
                  ]}
                  onPress={proceedSkipExercise}
                >
                  <Text style={styles.editBtnText}>Skip</Text>
                </Pressable>
              </View>
            </View>
          </View>
        </Modal>
        <Modal transparent visible={!!removeCandidate} animationType="fade">
          <View style={styles.editOverlay}>
            <View style={styles.editCard}>
              <Text style={styles.editTitle}>Remove exercise?</Text>
              <Text style={styles.cardMuted}>
                This removes it from today's workout preview only.
              </Text>
              <View style={styles.editActions}>
                <Pressable
                  accessibilityRole="button"
                  style={({ pressed }) => [styles.editBtn, pressed && styles.btnPressed]}
                  onPress={closeRemoveExercise}
                >
                  <Text style={styles.editBtnText}>Cancel</Text>
                </Pressable>
                <Pressable
                  accessibilityRole="button"
                  style={({ pressed }) => [
                    styles.editBtn,
                    styles.editBtnPrimary,
                    pressed && styles.btnPressed,
                  ]}
                  onPress={confirmRemoveExercise}
                >
                  <Text style={styles.editBtnText}>Remove</Text>
                </Pressable>
              </View>
            </View>
          </View>
        </Modal>
        <Modal transparent visible={!!editSetsExercise} animationType="fade">
          <View style={styles.editOverlay}>
            <View style={styles.editCard}>
              <Text style={styles.editTitle}>Edit sets</Text>
              <Text style={styles.cardMuted}>
                {editSetsExercise?.exercises?.name ?? 'Exercise'}
              </Text>
              <View style={styles.setCountRow}>
                <Pressable
                  accessibilityRole="button"
                  style={({ pressed }) => [styles.setCountBtn, pressed && styles.btnPressed]}
                  onPress={() =>
                    setEditSetCount((prev) =>
                      String(clamp(Number(prev || TEMPLATE_SETS.length) - 1, 1, TEMPLATE_SETS.length)),
                    )
                  }
                >
                  <Text style={styles.setCountBtnText}>−</Text>
                </Pressable>
                <TextInput
                  value={editSetCount}
                  onChangeText={(text) => setEditSetCount(text.replace(/[^\d]/g, '').slice(0, 2))}
                  maxLength={2}
                  keyboardType="number-pad"
                  inputMode="numeric"
                  style={styles.setCountInput}
                />
                <Pressable
                  accessibilityRole="button"
                  style={({ pressed }) => [styles.setCountBtn, pressed && styles.btnPressed]}
                  onPress={() =>
                    setEditSetCount((prev) =>
                      String(clamp(Number(prev || 1) + 1, 1, TEMPLATE_SETS.length)),
                    )
                  }
                >
                  <Text style={styles.setCountBtnText}>+</Text>
                </Pressable>
              </View>
              <View style={styles.editActions}>
                <Pressable
                  accessibilityRole="button"
                  style={({ pressed }) => [styles.editBtn, pressed && styles.btnPressed]}
                  onPress={closeEditSets}
                >
                  <Text style={styles.editBtnText}>Cancel</Text>
                </Pressable>
                <Pressable
                  accessibilityRole="button"
                  style={({ pressed }) => [
                    styles.editBtn,
                    styles.editBtnPrimary,
                    pressed && styles.btnPressed,
                  ]}
                  onPress={saveEditSets}
                >
                  <Text style={styles.editBtnText}>Save</Text>
                </Pressable>
              </View>
            </View>
          </View>
        </Modal>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#0B1220' },
  container: { flex: 1, padding: 16, gap: 16 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingBottom: 6,
  },
  headerText: { flex: 1 },
  title: { fontSize: 22, fontWeight: '900', color: '#FFFFFF' },
  headerBackBtn: {
    paddingVertical: 6,
    paddingHorizontal: 10,
  },
  headerBackText: { fontSize: 16, fontWeight: '700', color: '#2563EB' },
  workoutMetaRow: {
    marginTop: 6,
    gap: 4,
  },
  workoutMetaText: {
    fontSize: 12,
    fontWeight: '700',
    color: 'rgba(255,255,255,0.6)',
  },
  workoutNoteText: {
    fontSize: 12,
    fontWeight: '600',
    color: 'rgba(255,255,255,0.55)',
  },
  exerciseProgress: {
    fontSize: 12,
    fontWeight: '700',
    color: 'rgba(255,255,255,0.55)',
    marginTop: 4,
  },
  exerciseBlurb: {
    fontSize: 12,
    fontWeight: '600',
    color: 'rgba(255,255,255,0.55)',
    marginTop: 6,
  },
  badge: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: 'rgba(255,255,255,0.08)',
    borderWidth: 0.5,
    borderColor: 'rgba(255,255,255,0.12)',
  },
  badgeText: { fontSize: 12, fontWeight: '900', color: 'rgba(255,255,255,0.85)' },
  previewCard: {
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderRadius: 16,
    padding: 18,
    borderWidth: 0.5,
    borderColor: 'rgba(255,255,255,0.12)',
  },
  previewShell: { flex: 1 },
  previewScrollContent: {
    paddingBottom: 24,
  },
  previewFooter: {
    paddingTop: 12,
  },
  previewTitle: { fontSize: 18, fontWeight: '900', color: '#FFFFFF' },
  previewSubtitle: {
    fontSize: 13,
    fontWeight: '700',
    color: 'rgba(255,255,255,0.7)',
    marginTop: 6,
  },
  previewNote: {
    fontSize: 12,
    fontWeight: '600',
    color: 'rgba(255,255,255,0.6)',
    marginTop: 8,
  },
  previewList: { marginTop: 14, gap: 12 },
  previewRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 16,
    backgroundColor: 'rgba(255,255,255,0.05)',
    borderWidth: 0.5,
    borderColor: 'rgba(255,255,255,0.08)',
  },
  previewRowText: { flex: 1, marginRight: 12 },
  previewActions: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  previewName: { fontSize: 14, fontWeight: '900', color: '#FFFFFF' },
  previewMeta: {
    fontSize: 12,
    fontWeight: '700',
    color: 'rgba(255,255,255,0.6)',
    marginTop: 4,
  },
  previewSwapBtn: {
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 14,
    backgroundColor: 'rgba(37,99,235,0.18)',
    borderWidth: 0.5,
    borderColor: 'rgba(37,99,235,0.5)',
  },
  previewRemoveBtn: {
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 14,
    backgroundColor: 'rgba(239,68,68,0.16)',
    borderWidth: 0.5,
    borderColor: 'rgba(239,68,68,0.5)',
  },
  previewEditBtn: {
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 14,
    backgroundColor: 'rgba(148,163,184,0.18)',
    borderWidth: 0.5,
    borderColor: 'rgba(148,163,184,0.5)',
  },
  previewSwapOption: {
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 14,
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderWidth: 0.5,
    borderColor: 'rgba(255,255,255,0.1)',
    marginTop: 8,
  },
  setProgress: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingBottom: 8,
  },
  setDots: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  setProgressText: { fontSize: 14, color: 'rgba(255,255,255,0.75)' },
  setDot: {
    width: 12,
    height: 12,
    borderRadius: 6,
    borderWidth: 2,
    borderColor: 'rgba(255,255,255,0.35)',
    backgroundColor: 'transparent',
  },
  setDotComplete: {
    backgroundColor: '#FFFFFF',
    borderColor: '#FFFFFF',
  },
  setDotCurrent: {
    backgroundColor: '#FFFFFF',
    borderColor: '#FFFFFF',
    transform: [{ scale: 1.05 }],
  },
  card: {
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderRadius: 16,
    padding: 16,
    borderWidth: 0.5,
    borderColor: 'rgba(255,255,255,0.10)',
  },
  cardTitle: { fontSize: 12, fontWeight: '700', color: 'rgba(255,255,255,0.55)' },
  cardBig: {
    fontSize: 22,
    fontWeight: '900',
    color: '#FFFFFF',
    marginTop: 6,
    letterSpacing: -0.4,
  },
  cardMuted: { fontSize: 13, color: 'rgba(255,255,255,0.70)', marginTop: 6 },
  primaryBtn: {
    height: 52,
    borderRadius: 16,
    backgroundColor: '#16A34A',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 12,
    overflow: 'hidden',
  },
  primaryBtnGlow: {
    borderRadius: 16,
    shadowColor: '#22C55E',
    shadowOpacity: 0.6,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 8 },
    elevation: 6,
  },
  primaryBtnDisabled: { opacity: 0.5 },
  primaryBtnText: { color: '#FFFFFF', fontSize: 16, fontWeight: '900', letterSpacing: -0.2 },
  primaryBtnContent: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    zIndex: 2,
  },
  primaryBtnGradientTop: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: '55%',
    backgroundColor: 'rgba(255,255,255,0.18)',
  },
  primaryBtnGradientBottom: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    height: '55%',
    backgroundColor: 'rgba(0,0,0,0.12)',
  },
  secondaryBtn: {
    height: 48,
    borderRadius: 16,
    borderWidth: 0.5,
    borderColor: 'rgba(255,255,255,0.2)',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 10,
    backgroundColor: 'rgba(255,255,255,0.06)',
  },
  secondaryBtnText: { color: 'rgba(255,255,255,0.85)', fontSize: 14, fontWeight: '900' },
  logRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 6,
  },
  logRowPressable: {
    paddingHorizontal: 8,
    borderRadius: 12,
  },
  logLeft: { fontSize: 14, fontWeight: '900', color: 'rgba(255,255,255,0.75)' },
  logRight: { fontSize: 14, fontWeight: '900', color: '#FFFFFF', letterSpacing: -0.2 },
  logRightGroup: { flexDirection: 'row', alignItems: 'center', gap: 8 },
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
  timerSegmentsWrap: {
    position: 'absolute',
  },
  timerSegment: {
    position: 'absolute',
    borderRadius: 999,
  },
  timerInner: {
    position: 'absolute',
    backgroundColor: '#0B1220',
  },
  timerText: {
    fontSize: 56,
    fontWeight: '900',
    color: '#FFFFFF',
    textAlign: 'center',
    letterSpacing: -0.8,
  },
  timerHint: {
    fontSize: 14,
    fontWeight: '800',
    color: 'rgba(255,255,255,0.75)',
    marginTop: 6,
  },
  restMetaText: {
    fontSize: 13,
    fontWeight: '700',
    color: 'rgba(255,255,255,0.7)',
    marginTop: 6,
  },
  restInlineActions: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    marginTop: 18,
  },
  restInlineBtn: {
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderRadius: 16,
    backgroundColor: 'rgba(255,255,255,0.08)',
    borderWidth: 0.5,
    borderColor: 'rgba(255,255,255,0.12)',
  },
  restInlineText: { fontSize: 14, fontWeight: '900', color: '#FFFFFF' },
  restInlineDot: { fontSize: 16, fontWeight: '900', color: 'rgba(255,255,255,0.45)' },
  restInlineOverflow: {
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderRadius: 10,
    marginLeft: 6,
  },
  restInlineOverflowText: { fontSize: 13, fontWeight: '900', color: 'rgba(255,255,255,0.7)' },
  restFooterSpacer: { flex: 1 },
  restPrimaryBtn: {
    height: 56,
    borderRadius: 16,
    backgroundColor: '#2563EB',
    alignItems: 'center',
    justifyContent: 'center',
  },
  restPrimaryBtnText: { color: '#FFFFFF', fontSize: 16, fontWeight: '900', letterSpacing: -0.2 },
  restLinkText: { fontSize: 13, fontWeight: '900', color: 'rgba(255,255,255,0.85)' },
  restLinkSpacer: { height: 10 },
  linkBtn: {
    alignSelf: 'center',
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderRadius: 16,
    backgroundColor: 'rgba(37,99,235,0.18)',
    borderWidth: 0.5,
    borderColor: 'rgba(37,99,235,0.45)',
  },
  statWrap: { alignItems: 'center', flex: 1 },
  statLabel: { fontSize: 12, fontWeight: '700', color: 'rgba(255,255,255,0.55)', marginBottom: 10 },
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
    letterSpacing: -0.6,
  },
  statUnit: { fontSize: 14, fontWeight: '900', color: 'rgba(255,255,255,0.65)', marginTop: 2 },
  statControls: { flexDirection: 'row', gap: 12, marginTop: 12 },
  statBtn: {
    width: 56,
    height: 44,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.08)',
    borderWidth: 0.5,
    borderColor: 'rgba(255,255,255,0.12)',
  },
  statBtnText: { fontSize: 22, fontWeight: '900', color: '#FFFFFF' },
  statsGrid: { flexDirection: 'row', gap: 16, justifyContent: 'space-between' },
  btnPressed: { transform: [{ scale: 0.99 }], opacity: 0.95 },
  editOverlay: {
    flex: 1,
    backgroundColor: 'rgba(6,10,18,0.72)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  editCard: {
    width: '100%',
    borderRadius: 16,
    padding: 18,
    backgroundColor: '#0B1220',
    borderWidth: 0.5,
    borderColor: 'rgba(255,255,255,0.12)',
  },
  editTitle: { fontSize: 18, fontWeight: '900', color: '#FFFFFF', marginBottom: 12 },
  editField: { marginBottom: 12 },
  editLabel: { fontSize: 12, fontWeight: '700', color: 'rgba(255,255,255,0.55)' },
  editInput: {
    marginTop: 6,
    borderRadius: 14,
    paddingVertical: 10,
    paddingHorizontal: 12,
    backgroundColor: 'rgba(255,255,255,0.08)',
    color: '#FFFFFF',
    fontSize: 18,
    fontWeight: '900',
    letterSpacing: -0.3,
  },
  editActions: { flexDirection: 'row', justifyContent: 'flex-end', gap: 12, marginTop: 8 },
  editBtn: {
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderRadius: 14,
    backgroundColor: 'rgba(255,255,255,0.08)',
    borderWidth: 0.5,
    borderColor: 'rgba(255,255,255,0.12)',
  },
  editBtnPrimary: {
    backgroundColor: '#2563EB',
    borderColor: 'rgba(37,99,235,0.6)',
  },
  editBtnText: { color: '#FFFFFF', fontSize: 14, fontWeight: '900' },
  overflowAction: {
    paddingVertical: 12,
    paddingHorizontal: 12,
    borderRadius: 14,
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderWidth: 0.5,
    borderColor: 'rgba(255,255,255,0.12)',
    marginTop: 10,
  },
  overflowActionText: { color: '#FFFFFF', fontSize: 14, fontWeight: '900' },
  setCountRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginTop: 12,
  },
  setCountBtn: {
    width: 44,
    height: 44,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.08)',
    borderWidth: 0.5,
    borderColor: 'rgba(255,255,255,0.12)',
  },
  setCountBtnText: { fontSize: 20, fontWeight: '900', color: '#FFFFFF' },
  setCountInput: {
    flex: 1,
    textAlign: 'center',
    borderRadius: 12,
    paddingVertical: 10,
    paddingHorizontal: 12,
    backgroundColor: 'rgba(255,255,255,0.08)',
    color: '#FFFFFF',
    fontSize: 18,
    fontWeight: '900',
  },
});
