import { useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  AppState,
  Animated,
  ActivityIndicator,
  InputAccessoryView,
  Keyboard,
  Modal,
  Platform,
  Pressable,
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
import DraggableFlatList, { RenderItemParams } from 'react-native-draggable-flatlist';
import { SafeAreaView } from 'react-native-safe-area-context';

import { supabase } from '@/src/lib/supabase';

type TemplateSet = {
  targetReps: string;
  restSeconds: number;
};

type TemplateExercise = {
  id: string;
  exercise_id?: string | null;
  intent_blurb?: string | null;
  sort_order?: number | null;
  superset_group?: string | null;
  sets?: number | null;
  reps_min?: number | null;
  reps_max?: number | null;
  rest_seconds?: number | null;
  week_start?: number | null;
  week_end?: number | null;
  exercises?: {
    id: string;
    name?: string | null;
  } | null;
};

type WorkoutBlock =
  | {
      type: 'single';
      id: string;
      exercise: TemplateExercise;
    }
  | {
      type: 'superset';
      id: string;
      groupId: number;
      rounds: number;
      exercises: TemplateExercise[];
    };

type BlockLog =
  | {
      type: 'single';
      exercise_id: string;
      sets: SetLog[];
    }
  | {
      type: 'superset';
      groupId: number;
      rounds: {
        roundNumber: number;
        exercises: {
          exercise_id: string;
          sets: SetLog[];
        }[];
      }[];
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
  lastLog?: SetLog;
  restFinished: boolean;
  onAddRest: (seconds: number) => void;
  onSkipRest: () => void;
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
  skipLabel: string;
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

const getSupersetLabel = (groupKey?: string | null) => {
  if (!groupKey) {
    return 'Superset';
  }
  if (groupKey.toUpperCase().startsWith('WU')) {
    return 'Warm-up';
  }
  return 'Superset';
};

const buildWorkoutBlocks = (
  orderedExercises: TemplateExercise[],
  getSetCount: (exercise: TemplateExercise) => number,
): WorkoutBlock[] => {
  const blocks: WorkoutBlock[] = [];
  let index = 0;
  let groupCounter = 1;

  while (index < orderedExercises.length) {
    const current = orderedExercises[index];
    const groupKey = current.superset_group ?? null;

    if (!groupKey) {
      blocks.push({
        type: 'single',
        id: current.id,
        exercise: current,
      });
      index += 1;
      continue;
    }

    const groupItems: TemplateExercise[] = [current];
    let nextIndex = index + 1;
    while (
      nextIndex < orderedExercises.length &&
      orderedExercises[nextIndex].superset_group === groupKey
    ) {
      groupItems.push(orderedExercises[nextIndex]);
      nextIndex += 1;
    }

    if (groupItems.length === 1) {
      blocks.push({
        type: 'single',
        id: current.id,
        exercise: current,
      });
    } else {
      const rounds = groupItems.reduce((maxValue, exercise) => {
        const candidate = getSetCount(exercise);
        return candidate > maxValue ? candidate : maxValue;
      }, 0);
      const blockId = `superset-${groupKey}-${groupItems[0]?.id ?? groupCounter}`;
      blocks.push({
        type: 'superset',
        id: blockId,
        groupId: groupCounter,
        rounds: Math.max(1, rounds),
        exercises: groupItems,
      });
      groupCounter += 1;
    }

    index = nextIndex;
  }

  return blocks;
};

const useSetRunnerLogger = () => {
  const [logs, setLogs] = useState<SetLog[]>([]);

  const logSet = async (nextLog: SetLog) => {
    if (!nextLog.workoutSessionId || !nextLog.exerciseId) {
      console.warn('Missing session/exercise for set log', {
        workoutSessionId: nextLog.workoutSessionId,
        exerciseId: nextLog.exerciseId,
      });
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
      return;
    }

    if (error) {
      console.warn('Failed to insert set log', { error, payload });
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
  skipLabel,
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
          <Text style={styles.secondaryBtnText}>{skipLabel}</Text>
        </Pressable>
      </>
    );
  };

const SingleBlockCard = ({
  exercise,
  setCount,
  isEditMode,
  onOpenMenu,
  onDrag,
}: {
  exercise: TemplateExercise;
  setCount: number;
  isEditMode: boolean;
  onOpenMenu: () => void;
  onDrag?: () => void;
}) => {
  return (
    <View style={[styles.previewRow, isEditMode && styles.previewRowEdit]}>
      <View style={styles.previewRowLeft}>
        {isEditMode ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Reorder exercise"
            style={styles.dragHandle}
            onPressIn={onDrag}
          >
            <Feather name="menu" size={16} color="rgba(255,255,255,0.6)" />
          </Pressable>
        ) : null}
        <View style={styles.previewRowText}>
          <Text style={styles.previewName}>{exercise.exercises?.name ?? 'Exercise'}</Text>
          <Text style={styles.previewMeta}>{setCount} sets</Text>
        </View>
      </View>
      {isEditMode ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Exercise options"
          style={({ pressed }) => [styles.previewOverflowBtn, pressed && styles.btnPressed]}
          onPress={onOpenMenu}
        >
          <Feather name="more-horizontal" size={18} color="#FFFFFF" />
        </Pressable>
      ) : null}
    </View>
  );
};

const SupersetBlockCard = ({
  label,
  rounds,
  exercises,
  isEditMode,
  isExpanded,
  onToggleExpand,
  onAddExercise,
  onDeleteSuperset,
  onOpenMenu,
  getSetCount,
  onDrag,
  onReorderExercises,
}: {
  label: string;
  rounds: number;
  exercises: TemplateExercise[];
  isEditMode: boolean;
  isExpanded: boolean;
  onToggleExpand: () => void;
  onAddExercise: () => void;
  onDeleteSuperset: () => void;
  onOpenMenu: (exercise: TemplateExercise) => void;
  getSetCount: (exercise: TemplateExercise) => number;
  onDrag?: () => void;
  onReorderExercises: (nextExercises: TemplateExercise[]) => void;
}) => {
  return (
    <View style={styles.previewSupersetCard}>
      <View style={styles.previewSupersetHeader}>
        <View style={styles.previewSupersetHeaderLeft}>
          {isEditMode ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Reorder superset"
              style={styles.dragHandle}
              onPressIn={onDrag}
            >
              <Feather name="menu" size={16} color="rgba(255,255,255,0.6)" />
            </Pressable>
          ) : null}
          <Text style={styles.previewSupersetLabel}>
            {label} • {rounds} rounds
          </Text>
        </View>
        {isEditMode ? (
          <View style={styles.previewActions}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={isExpanded ? 'Collapse superset' : 'Expand superset'}
              style={({ pressed }) => [styles.previewIconBtn, pressed && styles.btnPressed]}
              onPress={onToggleExpand}
            >
              <Feather name={isExpanded ? 'chevron-up' : 'chevron-down'} size={16} color="#FFFFFF" />
            </Pressable>
          </View>
        ) : null}
      </View>
      {isEditMode ? (
        isExpanded ? (
          <View style={styles.previewSupersetList}>
            <DraggableFlatList
              data={exercises}
              keyExtractor={(item, index) => `${item.id}-${index}`}
              scrollEnabled={false}
              onDragEnd={({ data }) => onReorderExercises(data)}
              renderItem={({ item, drag, isActive, index }) => (
                <View
                  style={[
                    styles.previewRow,
                    styles.previewRowInline,
                    index > 0 && styles.previewRowInlineDivider,
                    isActive && styles.dragActiveRow,
                  ]}
                >
                  <View style={styles.previewRowLeft}>
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel="Reorder exercise"
                      style={styles.dragHandle}
                      onPressIn={drag}
                    >
                      <Feather name="menu" size={14} color="rgba(255,255,255,0.6)" />
                    </Pressable>
                    <View style={styles.previewRowText}>
                      <Text style={styles.previewName}>
                        {item.exercises?.name ?? 'Exercise'}
                      </Text>
                      <Text style={styles.previewMeta}>{getSetCount(item)} sets</Text>
                    </View>
                  </View>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="Exercise options"
                    style={({ pressed }) => [styles.previewOverflowBtn, pressed && styles.btnPressed]}
                    onPress={() => onOpenMenu(item)}
                  >
                    <Feather name="more-horizontal" size={18} color="#FFFFFF" />
                  </Pressable>
                </View>
              )}
            />
            <View style={styles.supersetFooter}>
              <View style={styles.supersetFooterDivider} />
              <Pressable
                accessibilityRole="button"
                style={({ pressed }) => [
                  styles.supersetFooterButton,
                  pressed && styles.btnPressed,
                ]}
                onPress={onAddExercise}
              >
                <Text style={styles.supersetFooterText}>Add exercise</Text>
              </Pressable>
              <Pressable
                accessibilityRole="button"
                style={({ pressed }) => [
                  styles.supersetFooterButton,
                  styles.supersetFooterButtonDanger,
                  pressed && styles.btnPressed,
                ]}
                onPress={onDeleteSuperset}
              >
                <Text style={styles.supersetFooterText}>Delete superset</Text>
              </Pressable>
            </View>
          </View>
        ) : null
      ) : (
        <View style={styles.previewSupersetList}>
          {exercises.map((exercise, index) => (
            <Text key={`${exercise.id}-${index}`} style={styles.previewSupersetItem}>
              {exercise.exercises?.name ?? 'Exercise'}
            </Text>
          ))}
        </View>
      )}
    </View>
  );
};

const WorkoutBlockCard = ({
  block,
  isEditMode,
  isExpanded,
  getSetCount,
  onToggleExpand,
  onAddExerciseToSuperset,
  onDeleteSuperset,
  onOpenMenu,
  onDrag,
  onReorderSupersetExercises,
}: {
  block: WorkoutBlock;
  isEditMode: boolean;
  isExpanded: boolean;
  getSetCount: (exercise: TemplateExercise) => number;
  onToggleExpand: () => void;
  onAddExerciseToSuperset: () => void;
  onDeleteSuperset: () => void;
  onOpenMenu: (exercise: TemplateExercise) => void;
  onDrag?: () => void;
  onReorderSupersetExercises: (nextExercises: TemplateExercise[]) => void;
}) => {
  if (block.type === 'single') {
    return (
      <SingleBlockCard
        exercise={block.exercise}
        setCount={getSetCount(block.exercise)}
        isEditMode={isEditMode}
        onOpenMenu={() => onOpenMenu(block.exercise)}
        onDrag={onDrag}
      />
    );
  }

  return (
    <SupersetBlockCard
      label={getSupersetLabel(block.exercises[0]?.superset_group)}
      rounds={block.rounds}
      exercises={block.exercises}
      isEditMode={isEditMode}
      isExpanded={isExpanded}
      onToggleExpand={onToggleExpand}
      onAddExercise={onAddExerciseToSuperset}
      onDeleteSuperset={onDeleteSuperset}
      onOpenMenu={onOpenMenu}
      getSetCount={getSetCount}
      onDrag={onDrag}
      onReorderExercises={onReorderSupersetExercises}
    />
  );
};

const CompletedSetsList = ({
  logs,
  onEdit,
  itemLabel = 'Set',
}: {
  logs: SetLog[];
  onEdit?: (log: SetLog) => void;
  itemLabel?: string;
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
            <Text style={styles.logLeft}>
              {itemLabel} {log.setNumber}
            </Text>
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
}: {
  remainingSeconds: number;
  totalSeconds: number;
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
    const isActive = remainingSeconds > 0;
    if (!isActive) {
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
  }, [remainingSeconds, pulse]);

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
          {remainingSeconds === 0 ? "You're good to go" : 'Resting'}
        </Text>
      </Animated.View>
    </View>
  );
};

const RestTimerScreen = ({
  nextSetLabel,
  remainingSeconds,
  totalSeconds,
  lastLog,
  restFinished,
  onAddRest,
  onSkipRest,
  onStartNextSet,
}: RestTimerScreenProps) => {
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

        <View style={styles.restCenterSection}>
          <BigTimer remainingSeconds={remainingSeconds} totalSeconds={totalSeconds} />

          <View style={styles.restInlineActions}>
            <Pressable
              accessibilityRole="button"
              style={({ pressed }) => [styles.restInlineBtn, pressed && styles.btnPressed]}
              onPress={() => onAddRest(-30)}
            >
              <Text style={styles.restInlineText}>-30s</Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              style={({ pressed }) => [styles.restInlineBtn, pressed && styles.btnPressed]}
              onPress={() => onAddRest(-15)}
            >
              <Text style={styles.restInlineText}>-15s</Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              style={({ pressed }) => [styles.restInlineBtn, pressed && styles.btnPressed]}
              onPress={() => onAddRest(15)}
            >
              <Text style={styles.restInlineText}>+15s</Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              style={({ pressed }) => [styles.restInlineBtn, pressed && styles.btnPressed]}
              onPress={() => onAddRest(30)}
            >
              <Text style={styles.restInlineText}>+30s</Text>
            </Pressable>
          </View>
        </View>

        <View style={styles.restFooterActions}>
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
      </View>
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
  const accessoryId = `stat-stepper-${label.toLowerCase()}-done`;

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
          returnKeyType="done"
          blurOnSubmit
          inputAccessoryViewID={Platform.OS === 'ios' ? accessoryId : undefined}
          onSubmitEditing={() => Keyboard.dismiss()}
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
      {Platform.OS === 'ios' ? (
        <InputAccessoryView nativeID={accessoryId}>
          <View style={styles.keyboardAccessory}>
            <Pressable
              accessibilityRole="button"
              style={({ pressed }) => [styles.keyboardDoneBtn, pressed && styles.btnPressed]}
              onPress={() => Keyboard.dismiss()}
            >
              <Text style={styles.keyboardDoneText}>Done</Text>
            </Pressable>
          </View>
        </InputAccessoryView>
      ) : null}
    </View>
  );
};

export default function WorkoutTemplateScreen() {
  const params = useLocalSearchParams<{ templateId?: string | string[] }>();
  const templateId = Array.isArray(params.templateId) ? params.templateId[0] : params.templateId;
  const resumeRequested = params.resume === '1';
  const router = useRouter();
  const navigation = useNavigation();
  const { logs, logSet, updateLog, resetLogs, hydrateLogs } = useSetRunnerLogger();

  const [mode, setMode] = useState<'preview' | 'lifting' | 'rest' | 'done'>('preview');
  const [currentBlockIndex, setCurrentBlockIndex] = useState(0);
  const [currentRoundIndex, setCurrentRoundIndex] = useState(0);
  const [currentBlockExerciseIndex, setCurrentBlockExerciseIndex] = useState(0);
  const [weight, setWeight] = useState(INITIAL_WEIGHT);
  const [reps, setReps] = useState(INITIAL_REPS);
  const [restRemaining, setRestRemaining] = useState(0);
  const [restTotal, setRestTotal] = useState(0);
  const [restEndsAtMs, setRestEndsAtMs] = useState<number | null>(null);
  const [restFinished, setRestFinished] = useState(false);
  const [templateExercises, setTemplateExercises] = useState<TemplateExercise[]>([]);
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
  const [isEditMode, setIsEditMode] = useState(false);
  const [expandedSupersetIds, setExpandedSupersetIds] = useState<Record<string, boolean>>({});
  const [removeSupersetCandidate, setRemoveSupersetCandidate] = useState<WorkoutBlock | null>(null);
  const [overflowMenu, setOverflowMenu] = useState<{
    kind: 'single' | 'superset-item';
    exercise: TemplateExercise;
  } | null>(null);
  const [resumeChecking, setResumeChecking] = useState(resumeRequested);
  const [exercisesLoaded, setExercisesLoaded] = useState(false);
  const [blockLogs, setBlockLogs] = useState<BlockLog[]>([]);
  const [showSkipConfirm, setShowSkipConfirm] = useState(false);
  const [workoutMeta, setWorkoutMeta] = useState<WorkoutTemplateMeta | null>(null);

  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const resumeAttemptedRef = useRef(false);
  const restTickedRef = useRef(false);
  const lastSetCacheRef = useRef(new Map<string, { weight: number; reps: number }>());
  const prefillTargetRef = useRef<string | null>(null);

  const orderedExercises = useMemo(() => {
    return [...templateExercises].sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0));
  }, [templateExercises]);
  const getExerciseSetCount = useCallback(
    (exercise?: TemplateExercise | null) => {
      if (!exercise) {
        return TEMPLATE_SETS.length;
      }
      return exerciseSetCounts[exercise.id] ?? exercise.sets ?? TEMPLATE_SETS.length;
    },
    [exerciseSetCounts],
  );
  const workoutBlocks = useMemo(
    () => buildWorkoutBlocks(orderedExercises, (exercise) => getExerciseSetCount(exercise)),
    [orderedExercises, getExerciseSetCount],
  );
  const totalBlocks = Math.max(workoutBlocks.length, 1);
  const isLastBlock = currentBlockIndex >= totalBlocks - 1;
  const currentBlock = workoutBlocks[currentBlockIndex] ?? null;
  const blockExercises =
    currentBlock?.type === 'superset'
      ? currentBlock.exercises
      : currentBlock
      ? [currentBlock.exercise]
      : [];
  const isSupersetBlock = currentBlock?.type === 'superset';
  const currentExercise = blockExercises[currentBlockExerciseIndex] ?? null;
  const blockRoundCount = blockExercises.reduce((maxValue, exercise) => {
    const candidate = getExerciseSetCount(exercise);
    return candidate > maxValue ? candidate : maxValue;
  }, 0);
  const currentExerciseSetCount = getExerciseSetCount(currentExercise);
  const templateSets = TEMPLATE_SETS.slice(0, Math.max(1, currentExerciseSetCount));
  const totalRounds = isSupersetBlock ? Math.max(1, blockRoundCount) : templateSets.length;
  const isLastRound = currentRoundIndex >= totalRounds - 1;
  const isLastExerciseInBlock = currentBlockExerciseIndex >= blockExercises.length - 1;
  const currentTemplateSet = templateSets[Math.min(currentRoundIndex, templateSets.length - 1)];
  const lastLog = logs.at(-1);
  const exerciseName = currentExercise?.exercises?.name ?? EXERCISE_NAME;
  const currentExerciseId =
    currentExercise?.exercise_id ?? currentExercise?.exercises?.id ?? null;
  const workoutNote = workoutMeta?.notes ?? null;
  const workoutDurationMinutes = workoutMeta?.target_duration_min ?? null;

  const targetLine = useMemo(() => {
    return `${currentTemplateSet?.targetReps ?? ''} reps`;
  }, [currentTemplateSet]);

  const currentSupersetLabel = isSupersetBlock
    ? getSupersetLabel(currentExercise?.superset_group ?? null)
    : null;

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
      setRestEndsAtMs(null);
      return;
    }

    if (intervalRef.current) {
      clearInterval(intervalRef.current);
    }

    const syncRemaining = () => {
      if (!restEndsAtMs) {
        return;
      }
      const nextRemaining = Math.max(0, Math.ceil((restEndsAtMs - Date.now()) / 1000));
      setRestRemaining((prev) => (prev === nextRemaining ? prev : nextRemaining));
    };

    syncRemaining();
    intervalRef.current = setInterval(() => {
      syncRemaining();
    }, 250);

    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
      }
      intervalRef.current = null;
    };
  }, [mode, restEndsAtMs]);

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (state) => {
      if (state !== 'active' || mode !== 'rest' || !restEndsAtMs) {
        return;
      }
      const nextRemaining = Math.max(0, Math.ceil((restEndsAtMs - Date.now()) / 1000));
      setRestRemaining(nextRemaining);
    });

    return () => {
      subscription.remove();
    };
  }, [mode, restEndsAtMs]);

  useEffect(() => {
    if (mode !== 'rest' || restRemaining !== 0 || restFinished) {
      return;
    }

    setRestFinished(true);
    void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    Vibration.vibrate(200);

    if (!TIMER_ENDS_SHOWS_BUTTON) {
      handleRestAdvance();
    }
  }, [mode, restRemaining, restFinished, handleRestAdvance]);

  useEffect(() => {
    if (mode !== 'rest' || restRemaining !== 30 || restTickedRef.current) {
      return;
    }
    restTickedRef.current = true;
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
  }, [mode, restRemaining]);

  useEffect(() => {
    if (mode === 'preview' || !isEditMode) {
      return;
    }
    setIsEditMode(false);
    setExpandedSupersetIds({});
  }, [isEditMode, mode]);

  useEffect(() => {
    if (!resumeRequested) {
      setResumeChecking(false);
    }
  }, [resumeRequested]);

  useEffect(() => {
    let isMounted = true;

    const loadExercises = async () => {
      if (!templateId) {
        if (isMounted) {
          setTemplateExercises([]);
          setCurrentBlockIndex(0);
          setCurrentBlockExerciseIndex(0);
          setCurrentRoundIndex(0);
          setExercisesLoaded(false);
        }
        return;
      }

      setTemplateExercises([]);
      setExercisesLoaded(false);
      setCurrentBlockIndex(0);
      setCurrentBlockExerciseIndex(0);
      setCurrentRoundIndex(0);
      resetLogs();
      resumeAttemptedRef.current = false;
      setExerciseSetCounts({});
      setBlockLogs([]);
      setWeight(INITIAL_WEIGHT);
      setReps(INITIAL_REPS);
      setRestRemaining(0);
      setRestTotal(0);
      setRestEndsAtMs(null);
      setRestFinished(false);
      setMode('preview');
      setWorkoutSessionId(null);
      setWorkoutMeta(null);

      const selectColumns =
        'id, exercise_id, intent_blurb, sort_order, superset_group, sets, reps_min, reps_max, rest_seconds, week_start, week_end, exercises ( id, name )';

      const resolveCurrentWeek = async () => {
        const { data: userData } = await supabase.auth.getUser();
        const userId = userData?.user?.id ?? null;
        if (!userId) {
          return null;
        }

        const { data: activeProgram } = await supabase
          .from('user_programs')
          .select('id')
          .eq('active', true)
          .eq('user_id', userId)
          .maybeSingle();

        if (!activeProgram?.id) {
          return null;
        }

        const { data: progressData } = await supabase
          .from('user_program_progress')
          .select('current_week, next_program_schedule_id')
          .eq('user_program_id', activeProgram.id)
          .maybeSingle();

        const currentWeek =
          (progressData as { current_week?: number | null } | null)?.current_week ?? null;
        if (typeof currentWeek === 'number' && Number.isFinite(currentWeek) && currentWeek > 0) {
          return currentWeek;
        }

        const nextScheduleId =
          (progressData as { next_program_schedule_id?: string | null } | null)
            ?.next_program_schedule_id ?? null;
        if (!nextScheduleId) {
          return null;
        }

        const { data: scheduleData } = await supabase
          .from('program_schedule')
          .select('week_number')
          .eq('id', nextScheduleId)
          .maybeSingle();

        const nextWeek = (scheduleData as { week_number?: number | null } | null)?.week_number ?? null;
        if (typeof nextWeek === 'number' && Number.isFinite(nextWeek) && nextWeek > 0) {
          return nextWeek;
        }

        return null;
      };

      const pickFallbackRows = (rows: TemplateExercise[]) => {
        const unboundedRows = rows.filter(
          (row) => row.week_start == null && row.week_end == null,
        );
        if (unboundedRows.length > 0) {
          return unboundedRows;
        }

        const partiallyBoundedRows = rows.filter(
          (row) =>
            (row.week_start == null && row.week_end != null) ||
            (row.week_start != null && row.week_end == null),
        );
        if (partiallyBoundedRows.length > 0) {
          return partiallyBoundedRows;
        }

        const fullyBoundedRows = rows.filter(
          (row) =>
            typeof row.week_start === 'number' &&
            Number.isFinite(row.week_start) &&
            typeof row.week_end === 'number' &&
            Number.isFinite(row.week_end),
        );
        if (fullyBoundedRows.length === 0) {
          return rows;
        }

        const widestSpan = fullyBoundedRows.reduce((maxSpan, row) => {
          const span = Math.max(0, (row.week_end ?? 0) - (row.week_start ?? 0));
          return Math.max(maxSpan, span);
        }, 0);

        return fullyBoundedRows.filter(
          (row) => Math.max(0, (row.week_end ?? 0) - (row.week_start ?? 0)) === widestSpan,
        );
      };

      const currentWeek = await resolveCurrentWeek();

      let weekMatchedRows: TemplateExercise[] = [];
      if (currentWeek !== null) {
        const { data: scopedData, error: scopedError } = await supabase
          .from('workout_template_exercises')
          .select(selectColumns)
          .eq('workout_template_id', templateId)
          .or(`week_start.is.null,week_start.lte.${currentWeek}`)
          .or(`week_end.is.null,week_end.gte.${currentWeek}`)
          .order('sort_order', { ascending: true });

        if (!scopedError) {
          weekMatchedRows = (scopedData as TemplateExercise[]) ?? [];
        }
      }

      if (!isMounted) {
        return;
      }

      if (weekMatchedRows.length > 0) {
        setTemplateExercises(weekMatchedRows);
        setExercisesLoaded(true);
        return;
      }

      const { data: allRowsData } = await supabase
        .from('workout_template_exercises')
        .select(selectColumns)
        .eq('workout_template_id', templateId)
        .order('sort_order', { ascending: true });

      if (!isMounted) {
        return;
      }

      const allRows = (allRowsData as TemplateExercise[]) ?? [];
      setTemplateExercises(pickFallbackRows(allRows));
      setExercisesLoaded(true);
    };

    void loadExercises();

    return () => {
      isMounted = false;
    };
  }, [templateId]);

  useEffect(() => {
    let isMounted = true;

    const resumeActiveSession = async () => {
      if (!resumeRequested || !templateId || !exercisesLoaded || resumeAttemptedRef.current) {
        return;
      }
      resumeAttemptedRef.current = true;

      const { data: userData } = await supabase.auth.getUser();
      const userId = userData?.user?.id ?? null;
      if (!userId) {
        setResumeChecking(false);
        return;
      }

      const { data: activeProgram } = await supabase
        .from('user_programs')
        .select('id, program_id')
        .eq('active', true)
        .eq('user_id', userId)
        .maybeSingle();

      if (!activeProgram?.id) {
        setResumeChecking(false);
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
        setResumeChecking(false);
        return;
      }

      if (sessionData.workout_template_id && sessionData.workout_template_id !== templateId) {
        setResumeChecking(false);
        return;
      }

      setWorkoutSessionId(sessionData.id);

      const { data: logsData } = await supabase
        .from('set_logs')
        .select('id, set_number, weight, reps, session_id, exercise_id')
        .eq('session_id', sessionData.id);

      if (!isMounted) {
        setResumeChecking(false);
        return;
      }

      const allLogs = (logsData as SetLogRow[] | null) ?? [];

      const logByExerciseId = new Map<string, SetLogRow[]>();
      allLogs.forEach((log) => {
        if (!log.exercise_id) {
          return;
        }
        const existing = logByExerciseId.get(log.exercise_id) ?? [];
        existing.push(log);
        logByExerciseId.set(log.exercise_id, existing);
      });

      const toSetLog = (log: SetLogRow): SetLog => ({
        localId: log.id,
        id: log.id,
        setNumber: log.set_number,
        weight: log.weight,
        reps: log.reps,
        workoutSessionId: log.session_id ?? null,
        exerciseId: log.exercise_id ?? null,
      });

      const nextState = {
        blockIndex: 0,
        roundIndex: 0,
        exerciseIndex: 0,
        found: false,
      };

      const blockLogsNext: BlockLog[] = workoutBlocks.map((block) => {
        if (block.type === 'single') {
          const exerciseId = block.exercise.exercise_id ?? block.exercise.exercises?.id ?? '';
          const sets =
            exerciseId && logByExerciseId.has(exerciseId)
              ? logByExerciseId.get(exerciseId)!.map(toSetLog)
              : [];
          return { type: 'single', exercise_id: exerciseId, sets };
        }

        const rounds: {
          roundNumber: number;
          exercises: { exercise_id: string; sets: SetLog[] }[];
        }[] = [];
        const roundCount = block.exercises.reduce((maxValue, exercise) => {
          const candidate = getExerciseSetCount(exercise);
          return candidate > maxValue ? candidate : maxValue;
        }, 0);
        for (let round = 1; round <= Math.max(1, roundCount); round += 1) {
          const exercises = block.exercises.map((exercise) => {
            const exerciseId = exercise.exercise_id ?? exercise.exercises?.id ?? '';
            const logsForExercise = logByExerciseId.get(exerciseId) ?? [];
            const roundSets = logsForExercise
              .filter((log) => log.set_number === round)
              .map(toSetLog);
            return { exercise_id: exerciseId, sets: roundSets };
          });
          rounds.push({ roundNumber: round, exercises });
        }
        return { type: 'superset', groupId: block.groupId, rounds };
      });

      for (let blockIndex = 0; blockIndex < workoutBlocks.length; blockIndex += 1) {
        const block = workoutBlocks[blockIndex];
        if (block.type === 'single') {
          const exerciseId = block.exercise.exercise_id ?? block.exercise.exercises?.id ?? '';
          const totalSets = getExerciseSetCount(block.exercise);
          const completedSets = (logByExerciseId.get(exerciseId) ?? []).length;
          if (completedSets < totalSets) {
            nextState.blockIndex = blockIndex;
            nextState.roundIndex = Math.min(completedSets, totalSets - 1);
            nextState.exerciseIndex = 0;
            nextState.found = true;
            break;
          }
          continue;
        }

        const roundCount = block.exercises.reduce((maxValue, exercise) => {
          const candidate = getExerciseSetCount(exercise);
          return candidate > maxValue ? candidate : maxValue;
        }, 0);
        for (let round = 1; round <= Math.max(1, roundCount); round += 1) {
          for (let exIndex = 0; exIndex < block.exercises.length; exIndex += 1) {
            const exercise = block.exercises[exIndex];
            const exerciseId = exercise.exercise_id ?? exercise.exercises?.id ?? '';
            const hasLog = (logByExerciseId.get(exerciseId) ?? []).some(
              (log) => log.set_number === round,
            );
            if (!hasLog) {
              nextState.blockIndex = blockIndex;
              nextState.roundIndex = round - 1;
              nextState.exerciseIndex = exIndex;
              nextState.found = true;
              break;
            }
          }
          if (nextState.found) {
            break;
          }
        }
        if (nextState.found) {
          break;
        }
      }

      setBlockLogs(blockLogsNext);
      setCurrentBlockIndex(nextState.blockIndex);
      setCurrentRoundIndex(nextState.roundIndex);
      setCurrentBlockExerciseIndex(nextState.exerciseIndex);

      const activeBlock = workoutBlocks[nextState.blockIndex] ?? null;
      const activeExercises =
        activeBlock?.type === 'superset'
          ? activeBlock.exercises
          : activeBlock
          ? [activeBlock.exercise]
          : [];
      const activeExercise = activeExercises[nextState.exerciseIndex] ?? null;
      const activeExerciseId = activeExercise?.exercise_id ?? activeExercise?.exercises?.id ?? '';
      const currentExerciseLogs = (logByExerciseId.get(activeExerciseId) ?? [])
        .filter((log) => log.set_number <= nextState.roundIndex + 1)
        .sort((a, b) => a.set_number - b.set_number)
        .map(toSetLog);
      hydrateLogs(currentExerciseLogs);

      const lastLoggedSet = currentExerciseLogs.at(-1);
      if (lastLoggedSet) {
        setWeight(lastLoggedSet.weight);
        setReps(lastLoggedSet.reps);
      }

      if (!nextState.found) {
        setMode('done');
        setResumeChecking(false);
        return;
      }

      setMode('lifting');
      setResumeChecking(false);
    };

    void resumeActiveSession();

    return () => {
      isMounted = false;
    };
  }, [
    exercisesLoaded,
    getExerciseSetCount,
    hydrateLogs,
    resumeRequested,
    templateId,
    workoutBlocks,
  ]);

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
      console.warn('Failed to start workout session', {
        error,
        userId,
        userProgramId: activeProgram.id,
        programId: activeProgram.program_id,
        programScheduleId: scheduleData.id,
        workoutTemplateId: scheduleData.workout_template_id,
      });
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

  const getExerciseLogs = useCallback(
    (exerciseId: string | null | undefined) => {
      if (!exerciseId) {
        return [];
      }
      const logsForExercise: SetLog[] = [];
      blockLogs.forEach((log) => {
        if (log.type === 'single' && log.exercise_id === exerciseId) {
          logsForExercise.push(...log.sets);
        } else if (log.type === 'superset') {
          log.rounds.forEach((round) => {
            round.exercises.forEach((exercise) => {
              if (exercise.exercise_id === exerciseId) {
                logsForExercise.push(...exercise.sets);
              }
            });
          });
        }
      });
      return logsForExercise.sort((a, b) => a.setNumber - b.setNumber);
    },
    [blockLogs],
  );

  const fetchLastLoggedSet = useCallback(async (exerciseId: string) => {
    const cached = lastSetCacheRef.current.get(exerciseId);
    if (cached) {
      return cached;
    }

    const { data: userData } = await supabase.auth.getUser();
    const userId = userData?.user?.id ?? null;
    if (!userId) {
      return null;
    }

    const { data } = await supabase
      .from('set_logs')
      .select('weight, reps, logged_at, workout_sessions!inner(user_id)')
      .eq('exercise_id', exerciseId)
      .eq('workout_sessions.user_id', userId)
      .not('weight', 'is', null)
      .not('reps', 'is', null)
      .order('logged_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    const weight = typeof data?.weight === 'number' ? data.weight : null;
    const reps = typeof data?.reps === 'number' ? data.reps : null;
    if (weight === null || reps === null) {
      return null;
    }

    const entry = { weight, reps };
    lastSetCacheRef.current.set(exerciseId, entry);
    return entry;
  }, []);

  const applyDefaultSetValues = useCallback(
    async (exerciseId: string, setNumber: number) => {
      const targetKey = `${exerciseId}:${setNumber}`;
      prefillTargetRef.current = targetKey;

      const logsForExercise = getExerciseLogs(exerciseId);
      const hasLoggedSet = logsForExercise.some((log) => log.setNumber === setNumber);
      if (hasLoggedSet) {
        return;
      }

      const lastLocalLog = logsForExercise.at(-1);
      if (lastLocalLog) {
        setWeight(lastLocalLog.weight);
        setReps(lastLocalLog.reps);
        return;
      }

      const lastLogged = await fetchLastLoggedSet(exerciseId);
      if (prefillTargetRef.current !== targetKey) {
        return;
      }
      if (lastLogged) {
        setWeight(lastLogged.weight);
        setReps(lastLogged.reps);
        return;
      }

      setWeight(INITIAL_WEIGHT);
      setReps(INITIAL_REPS);
    },
    [fetchLastLoggedSet, getExerciseLogs],
  );

  useEffect(() => {
    if (mode !== 'lifting' || !currentExerciseId) {
      return;
    }
    void applyDefaultSetValues(currentExerciseId, currentRoundIndex + 1);
  }, [applyDefaultSetValues, currentExerciseId, currentRoundIndex, mode]);

  const updateBlockLogsWithSet = useCallback(
    (log: SetLog) => {
      if (!currentExercise || !currentBlock) {
        return;
      }
      setBlockLogs((prev) => {
        const collectLogs = (exerciseId: string | null | undefined) => {
          if (!exerciseId) {
            return [];
          }
          const collected: SetLog[] = [];
          prev.forEach((entry) => {
            if (entry.type === 'single' && entry.exercise_id === exerciseId) {
              collected.push(...entry.sets);
            } else if (entry.type === 'superset') {
              entry.rounds.forEach((round) => {
                round.exercises.forEach((exercise) => {
                  if (exercise.exercise_id === exerciseId) {
                    collected.push(...exercise.sets);
                  }
                });
              });
            }
          });
          return collected;
        };

        if (currentBlock.type === 'single') {
          const next = prev.filter(
            (entry) => !(entry.type === 'single' && entry.exercise_id === log.exerciseId),
          );
          next.push({
            type: 'single',
            exercise_id: log.exerciseId ?? '',
            sets: [...collectLogs(log.exerciseId), log],
          });
          return next;
        }

        const next = prev.filter(
          (entry) => !(entry.type === 'superset' && entry.groupId === currentBlock.groupId),
        );
        const rounds: {
          roundNumber: number;
          exercises: { exercise_id: string; sets: SetLog[] }[];
        }[] = [];
        const roundCount = Math.max(1, totalRounds);
        for (let round = 1; round <= roundCount; round += 1) {
          const exercises = currentBlock.exercises.map((exercise) => {
            const exerciseId = exercise.exercise_id ?? exercise.exercises?.id ?? '';
            const existing = collectLogs(exerciseId).filter((set) => set.setNumber === round);
            const merged =
              round === currentRoundIndex + 1 && exerciseId === log.exerciseId
                ? [...existing, log]
                : existing;
            return { exercise_id: exerciseId, sets: merged };
          });
          rounds.push({ roundNumber: round, exercises });
        }
        next.push({ type: 'superset', groupId: currentBlock.groupId, rounds });
        return next;
      });
    },
    [currentBlock, currentExercise, currentRoundIndex, totalRounds],
  );

  const updateBlockLogsWithEdit = useCallback((updatedLog: SetLog) => {
    setBlockLogs((prev) =>
      prev.map((entry) => {
        if (entry.type === 'single') {
          if (entry.exercise_id !== updatedLog.exerciseId) {
            return entry;
          }
          return {
            ...entry,
            sets: entry.sets.map((set) => (set.localId === updatedLog.localId ? updatedLog : set)),
          };
        }
        return {
          ...entry,
          rounds: entry.rounds.map((round) => ({
            ...round,
            exercises: round.exercises.map((exercise) => {
              if (exercise.exercise_id !== updatedLog.exerciseId) {
                return exercise;
              }
              return {
                ...exercise,
                sets: exercise.sets.map((set) =>
                  set.localId === updatedLog.localId ? updatedLog : set,
                ),
              };
            }),
          })),
        };
      }),
    );
  }, []);

  const completeSet = async () => {
    if (reps <= 0 || weight < 0) {
      return;
    }

    const sessionId = await ensureWorkoutSession();
    if (!currentExercise?.exercise_id) {
      return;
    }

    // Superset execution: iterate exercises in a block per round, then rest after each round.
    const localLog: SetLog = {
      localId: `${Date.now()}-${currentRoundIndex}-${currentBlockExerciseIndex}`,
      setNumber: currentRoundIndex + 1,
      weight,
      reps,
      workoutSessionId: sessionId,
      exerciseId: currentExercise.exercise_id ?? null,
    };

    void logSet(localLog);
    updateBlockLogsWithSet(localLog);
    if (currentExercise?.exercise_id) {
      lastSetCacheRef.current.set(currentExercise.exercise_id, { weight, reps });
    }

    const baseRestSeconds =
      currentExercise.rest_seconds ?? currentTemplateSet?.restSeconds ?? 90;

    if (isSupersetBlock) {
      if (!isLastExerciseInBlock) {
        const nextExerciseIndex = currentBlockExerciseIndex + 1;
        setCurrentBlockExerciseIndex(nextExerciseIndex);
        const nextExercise = blockExercises[nextExerciseIndex];
        const nextLogs = getExerciseLogs(nextExercise?.exercise_id ?? null);
        hydrateLogs(nextLogs);
        const lastExerciseLog = nextLogs.at(-1);
        if (lastExerciseLog) {
          setWeight(lastExerciseLog.weight);
          setReps(lastExerciseLog.reps);
        } else {
          setWeight(INITIAL_WEIGHT);
          setReps(INITIAL_REPS);
        }
        setMode('lifting');
        return;
      }

      if (!isLastRound) {
        const blockRestSeconds = blockExercises.reduce((maxValue, exercise) => {
          const candidate = exercise.rest_seconds ?? baseRestSeconds;
          return candidate > maxValue ? candidate : maxValue;
        }, 0);
        setRestEndsAtMs(Date.now() + blockRestSeconds * 1000);
        setRestFinished(false);
        setRestTotal(blockRestSeconds);
        setRestRemaining(blockRestSeconds);
        pendingAdvanceRef.current = 'round';
        setMode('rest');
        return;
      }
    } else {
      if (!isLastRound) {
        setRestEndsAtMs(Date.now() + baseRestSeconds * 1000);
        setRestFinished(false);
        setRestTotal(baseRestSeconds);
        setRestRemaining(baseRestSeconds);
        pendingAdvanceRef.current = 'round';
        setMode('rest');
        return;
      }
    }

    if (isLastBlock) {
      setMode('done');
      return;
    }

    const nextBlockRestSeconds = currentExercise?.rest_seconds ?? baseRestSeconds;
    if (nextBlockRestSeconds > 0) {
      setRestEndsAtMs(Date.now() + nextBlockRestSeconds * 1000);
      setRestFinished(false);
      setRestTotal(nextBlockRestSeconds);
      setRestRemaining(nextBlockRestSeconds);
      pendingAdvanceRef.current = 'block';
      setMode('rest');
      return;
    }

    goToNextBlock();
  };

  const resetForBlock = () => {
    resetLogs();
    setCurrentRoundIndex(0);
    setCurrentBlockExerciseIndex(0);
    setWeight(INITIAL_WEIGHT);
    setReps(INITIAL_REPS);
    setRestRemaining(0);
    setRestTotal(0);
    setRestEndsAtMs(null);
    setRestFinished(false);
    pendingAdvanceRef.current = null;
    setMode('lifting');
  };

  const advanceRound = useCallback(() => {
    const nextRound = currentRoundIndex + 1;
    setCurrentRoundIndex(nextRound);
    setCurrentBlockExerciseIndex(0);
    const nextExercise = blockExercises[0] ?? null;
    const nextLogs = getExerciseLogs(nextExercise?.exercise_id ?? null);
    hydrateLogs(nextLogs);
    const lastExerciseLog = nextLogs.at(-1);
    if (lastExerciseLog) {
      setWeight(lastExerciseLog.weight);
      setReps(lastExerciseLog.reps);
    } else {
      setWeight(INITIAL_WEIGHT);
      setReps(INITIAL_REPS);
    }
    prefillForNextSet();
    setRestRemaining(0);
    setRestTotal(0);
    setRestEndsAtMs(null);
    setRestFinished(false);
    setMode('lifting');
  }, [
    blockExercises,
    currentRoundIndex,
    getExerciseLogs,
    hydrateLogs,
    prefillForNextSet,
  ]);

  const pendingAdvanceRef = useRef<'round' | 'block' | null>(null);

  const addRest = (seconds: number) => {
    const now = Date.now();
    const currentEndsAt = restEndsAtMs ?? now + restRemaining * 1000;
    const nextEndsAt = Math.max(now, currentEndsAt + seconds * 1000);
    const nextRemaining = Math.max(0, Math.ceil((nextEndsAt - now) / 1000));

    setRestRemaining(nextRemaining);
    setRestTotal((prev) => Math.max(nextRemaining, clamp(prev + seconds, 0, 60 * 60)));
    setRestEndsAtMs(nextRemaining > 0 ? nextEndsAt : null);
    setRestFinished(nextRemaining === 0);
  };

  const skipRest = () => {
    pendingAdvanceRef.current = null;
    setRestRemaining(0);
    setRestEndsAtMs(null);
    setRestFinished(true);
  };

  const markWorkoutSessionComplete = async () => {
    const sessionId = workoutSessionId ?? (await ensureWorkoutSession());
    if (!sessionId) {
      return;
    }
    const completedAt = new Date().toISOString();
    const { data: completedSession, error: completeError } = await supabase
      .from('workout_sessions')
      .update({ completed_at: completedAt, status: 'completed' })
      .eq('id', sessionId)
      .select('id, user_program_id, program_id, program_schedule_id')
      .maybeSingle();

    if (completeError || !completedSession) {
      return;
    }

    const userProgramId = completedSession.user_program_id ?? null;
    const programId = completedSession.program_id ?? null;
    const currentScheduleId = completedSession.program_schedule_id ?? null;

    if (!userProgramId || !programId || !currentScheduleId) {
      return;
    }

    const { data: scheduleRows, error: scheduleError } = await supabase
      .from('program_schedule')
      .select('id, workout_template_id, week_number, day_number, sort_order')
      .eq('program_id', programId)
      .order('sort_order', { ascending: true })
      .order('week_number', { ascending: true })
      .order('day_number', { ascending: true })
      .order('id', { ascending: true });

    if (scheduleError) {
      return;
    }

    const orderedSchedules =
      (scheduleRows as {
        id: string;
        workout_template_id?: string | null;
        week_number?: number | null;
      }[] | null) ?? [];

    if (orderedSchedules.length === 0) {
      return;
    }

    const currentIndex = orderedSchedules.findIndex((schedule) => schedule.id === currentScheduleId);
    const nextSchedule =
      currentIndex >= 0 && currentIndex < orderedSchedules.length - 1
        ? orderedSchedules[currentIndex + 1]
        : null;

    await supabase.from('user_program_progress').upsert(
      {
        user_program_id: userProgramId,
        next_program_schedule_id: nextSchedule?.id ?? null,
        next_workout_template_id: nextSchedule?.workout_template_id ?? null,
        current_week: nextSchedule?.week_number ?? null,
        updated_at: completedAt,
      },
      { onConflict: 'user_program_id' },
    );
  };

  const goToNextWorkout = () => {
    resetLogs();
    pendingAdvanceRef.current = null;
    router.replace('/(tabs)');
  };

  const completeWorkout = async () => {
    await markWorkoutSessionComplete();
    resetLogs();
    pendingAdvanceRef.current = null;
    router.replace('/(tabs)');
  };

  const goToNextBlock = useCallback(() => {
    if (!isLastBlock) {
      setCurrentBlockIndex((prev) => prev + 1);
      resetForBlock();
      return;
    }

    goToNextWorkout();
  }, [isLastBlock]);

  const startWorkout = async () => {
    await ensureWorkoutSession();
    setMode('lifting');
  };

  const handleRestAdvance = useCallback(() => {
    const nextAdvance = pendingAdvanceRef.current;
    pendingAdvanceRef.current = null;
    if (nextAdvance === 'block') {
      goToNextBlock();
      return;
    }
    advanceRound();
  }, [advanceRound, goToNextBlock]);

  const normalizeSortOrder = useCallback((items: TemplateExercise[]) => {
    return items.map((exercise, index) => ({
      ...exercise,
      sort_order: index + 1,
    }));
  }, []);

  const addExerciseToSuperset = useCallback(
    (block: WorkoutBlock) => {
      if (block.type !== 'superset') {
        return;
      }
      const lastExercise = block.exercises[block.exercises.length - 1];
      if (!lastExercise) {
        return;
      }
      const newExercise: TemplateExercise = {
        ...lastExercise,
        id: `local-${Date.now()}-${Math.round(Math.random() * 1000)}`,
        sort_order: null,
      };
      const ordered = [...orderedExercises];
      const lastIndex = ordered.reduce((maxIndex, exercise, index) => {
        return block.exercises.some((item) => item.id === exercise.id)
          ? Math.max(maxIndex, index)
          : maxIndex;
      }, -1);
      const insertIndex = lastIndex >= 0 ? lastIndex + 1 : ordered.length;
      ordered.splice(insertIndex, 0, newExercise);
      setTemplateExercises(normalizeSortOrder(ordered));
    },
    [normalizeSortOrder, orderedExercises],
  );

  const reorderBlocks = useCallback(
    (nextBlocks: WorkoutBlock[]) => {
      const flattened = nextBlocks.flatMap((block) =>
        block.type === 'single' ? [block.exercise] : block.exercises,
      );
      setTemplateExercises(normalizeSortOrder(flattened));
    },
    [normalizeSortOrder],
  );

  const reorderSupersetExercises = useCallback(
    (block: WorkoutBlock, nextExercises: TemplateExercise[]) => {
      if (block.type !== 'superset') {
        return;
      }
      const blockIds = new Set(block.exercises.map((exercise) => exercise.id));
      const ordered = [...orderedExercises];
      const blockPositions = ordered
        .map((exercise, index) => (blockIds.has(exercise.id) ? index : -1))
        .filter((index) => index !== -1);
      if (blockPositions.length !== nextExercises.length) {
        return;
      }
      blockPositions.forEach((position, index) => {
        ordered[position] = nextExercises[index];
      });
      setTemplateExercises(normalizeSortOrder(ordered));
    },
    [normalizeSortOrder, orderedExercises],
  );

  const removeFromSuperset = useCallback((exercise: TemplateExercise) => {
    setTemplateExercises((prev) =>
      prev.map((item) =>
        item.id === exercise.id ? { ...item, superset_group: null } : item,
      ),
    );
  }, []);

  const openRemoveSuperset = (block: WorkoutBlock) => {
    if (block.type !== 'superset') {
      return;
    }
    if (removeCandidate) {
      setRemoveCandidate(null);
    }
    setRemoveSupersetCandidate(block);
  };

  const closeRemoveSuperset = () => {
    setRemoveSupersetCandidate(null);
  };

  const confirmRemoveSuperset = () => {
    if (!removeSupersetCandidate || removeSupersetCandidate.type !== 'superset') {
      return;
    }
    const blockIds = new Set(
      removeSupersetCandidate.exercises.map((exercise) => exercise.id),
    );
    setTemplateExercises((prev) => {
      if (prev.length <= blockIds.size) {
        return prev;
      }
      const next = prev.filter((exercise) => !blockIds.has(exercise.id));
      if (next.length === 0) {
        return prev;
      }
      setCurrentBlockIndex(0);
      setCurrentBlockExerciseIndex(0);
      setCurrentRoundIndex(0);
      return normalizeSortOrder(next);
    });
    closeRemoveSuperset();
  };

  const toggleEditMode = () => {
    setIsEditMode((prev) => {
      const next = !prev;
      if (!next) {
        setExpandedSupersetIds({});
      }
      return next;
    });
  };

  const toggleSupersetExpanded = (blockId: string) => {
    setExpandedSupersetIds((prev) => ({
      ...prev,
      [blockId]: !prev[blockId],
    }));
  };

  const openOverflowMenu = (
    kind: 'single' | 'superset-item',
    exercise: TemplateExercise,
  ) => {
    if (!isEditMode || mode !== 'preview') {
      return;
    }
    setOverflowMenu({ kind, exercise });
  };

  const closeOverflowMenu = () => {
    setOverflowMenu(null);
  };

  const openSubstitutions = async (exercise: TemplateExercise) => {
    if (overflowMenu) {
      setOverflowMenu(null);
    }
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
    if (overflowMenu) {
      setOverflowMenu(null);
    }
    setEditSetsExercise(exercise);
    const currentCount = getExerciseSetCount(exercise);
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
    if (removeSupersetCandidate) {
      setRemoveSupersetCandidate(null);
    }
    if (overflowMenu) {
      setOverflowMenu(null);
    }
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
      setCurrentBlockIndex(0);
      setCurrentBlockExerciseIndex(0);
      setCurrentRoundIndex(0);
      return normalizeSortOrder(next);
    });
    closeRemoveExercise();
  };

  const handleOverflowAction = (action: 'swap' | 'remove' | 'edit-sets') => {
    if (!overflowMenu) {
      return;
    }
    const { kind, exercise } = overflowMenu;
    setOverflowMenu(null);
    if (action === 'swap') {
      void openSubstitutions(exercise);
      return;
    }
    if (action === 'edit-sets') {
      openEditSets(exercise);
      return;
    }
    if (kind === 'superset-item') {
      removeFromSuperset(exercise);
      return;
    }
    openRemoveExercise(exercise);
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

  const markBlockSkipped = async () => {
    const sessionId = await ensureWorkoutSession();
    if (!sessionId || !currentBlock) {
      return;
    }
    const timestamp = new Date().toISOString();
    const logsToInsert: {
      session_id: string;
      exercise_id: string;
      set_number: number;
      reps: number | null;
      weight: number | null;
      is_bodyweight: boolean;
      was_pr: boolean;
      logged_at: string;
      completed: boolean;
    }[] = [];

    if (currentBlock.type === 'single') {
      for (let setNumber = currentRoundIndex + 1; setNumber <= totalRounds; setNumber += 1) {
        const exerciseId =
          currentBlock.exercise.exercise_id ?? currentBlock.exercise.exercises?.id ?? null;
        if (!exerciseId) {
          continue;
        }
        logsToInsert.push({
          session_id: sessionId,
          exercise_id: exerciseId,
          set_number: setNumber,
          reps: null,
          weight: null,
          is_bodyweight: false,
          was_pr: false,
          logged_at: timestamp,
          completed: false,
        });
      }
    } else {
      const exercises = currentBlock.exercises;
      for (let roundNumber = currentRoundIndex + 1; roundNumber <= totalRounds; roundNumber += 1) {
        const startIndex =
          roundNumber === currentRoundIndex + 1 ? currentBlockExerciseIndex : 0;
        for (let index = startIndex; index < exercises.length; index += 1) {
          const exercise = exercises[index];
          const exerciseId = exercise.exercise_id ?? exercise.exercises?.id ?? null;
          if (!exerciseId) {
            continue;
          }
          logsToInsert.push({
            session_id: sessionId,
            exercise_id: exerciseId,
            set_number: roundNumber,
            reps: null,
            weight: null,
            is_bodyweight: false,
            was_pr: false,
            logged_at: timestamp,
            completed: false,
          });
        }
      }
    }

    if (logsToInsert.length === 0) {
      return;
    }

    const { error } = await supabase.from('set_logs').insert(logsToInsert);
    if (error) {
      console.warn('Failed to mark skipped sets', error);
    }
  };

  const proceedSkipExercise = async () => {
    setShowSkipConfirm(false);
    await markBlockSkipped();
    goToNextBlock();
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
    updateBlockLogsWithEdit(updatedLog);
    cancelEdit();
  };

  const getBlockLeadExerciseName = (block?: WorkoutBlock | null) => {
    if (!block) {
      return null;
    }
    if (block.type === 'single') {
      return block.exercise.exercises?.name ?? null;
    }
    return block.exercises[0]?.exercises?.name ?? null;
  };

  const nextBlock = workoutBlocks[currentBlockIndex + 1] ?? null;
  const nextBlockLeadExerciseName = getBlockLeadExerciseName(nextBlock);
  const restNextLabel =
    pendingAdvanceRef.current === 'block'
      ? nextBlockLeadExerciseName
        ? `Next: ${nextBlockLeadExerciseName}`
        : `Next: Block ${Math.min(currentBlockIndex + 2, totalBlocks)} of ${totalBlocks}`
      : isSupersetBlock
      ? `Next: Round ${Math.min(currentRoundIndex + 2, totalRounds)} of ${totalRounds}`
      : `Next: Set ${Math.min(currentRoundIndex + 2, totalRounds)} of ${totalRounds}`;

  const renderWorkoutBlock = useCallback(
    ({ item, drag }: RenderItemParams<WorkoutBlock>) => {
      const isExpanded = expandedSupersetIds[item.id] ?? true;
      const menuKind = item.type === 'single' ? 'single' : 'superset-item';
      return (
        <WorkoutBlockCard
          block={item}
          isEditMode={isEditMode}
          isExpanded={isExpanded}
          getSetCount={getExerciseSetCount}
          onToggleExpand={() => toggleSupersetExpanded(item.id)}
          onAddExerciseToSuperset={() => addExerciseToSuperset(item)}
          onDeleteSuperset={() => openRemoveSuperset(item)}
          onOpenMenu={(exercise) => openOverflowMenu(menuKind, exercise)}
          onDrag={drag}
          onReorderSupersetExercises={(nextExercises) =>
            reorderSupersetExercises(item, nextExercises)
          }
        />
      );
    },
    [
      addExerciseToSuperset,
      expandedSupersetIds,
      getExerciseSetCount,
      isEditMode,
      openOverflowMenu,
      openRemoveSuperset,
      reorderSupersetExercises,
      toggleSupersetExpanded,
    ],
  );

  return (
    <SafeAreaView style={styles.safe} edges={['left', 'right', 'bottom']}>
      <View style={styles.container}>
        <View style={styles.header}>
          <View style={styles.headerText}>
            <Text style={styles.title}>{mode === 'preview' ? 'Workout Preview' : exerciseName}</Text>
            {mode === 'preview' ? null : (
              <Text style={styles.exerciseProgress}>
                Block {currentBlockIndex + 1} of {totalBlocks}
              </Text>
            )}
            {mode === 'preview' || !currentSupersetLabel ? null : (
              <Text style={styles.exerciseSuperset}>{currentSupersetLabel}</Text>
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
              {Array.from({ length: totalRounds }).map((_, index) => {
                const isComplete = index < currentRoundIndex;
                const isCurrent = index === currentRoundIndex;
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
              {isSupersetBlock ? 'Round' : 'Set'} {currentRoundIndex + 1} of {totalRounds}
            </Text>
          </View>
        )}

        {mode === 'preview' ? (
          <View style={styles.previewShell}>
            {resumeRequested && resumeChecking ? (
              <View style={styles.previewCard}>
                <Text style={styles.previewTitle}>Resuming workout…</Text>
                <View style={styles.previewLoadingRow}>
                  <ActivityIndicator color="#FFFFFF" />
                </View>
              </View>
            ) : (
              <ScrollView
                contentContainerStyle={styles.previewScrollContent}
                showsVerticalScrollIndicator={false}
              >
                <View style={styles.previewCard}>
                  <View style={styles.previewHeaderRow}>
                    <Text style={styles.previewTitle}>Today’s Workout</Text>
                    <Pressable
                      accessibilityRole="button"
                      style={({ pressed }) => [
                        styles.previewEditToggle,
                        pressed && styles.btnPressed,
                      ]}
                      onPress={toggleEditMode}
                    >
                      <Text style={styles.previewEditToggleText}>
                        {isEditMode ? 'Done' : 'Edit'}
                      </Text>
                    </Pressable>
                  </View>
                  {workoutDurationMinutes ? (
                    <Text style={styles.previewMeta}>Target {workoutDurationMinutes} min</Text>
                  ) : null}
                  {workoutNote ? (
                    <Text style={styles.previewNote}>{workoutNote}</Text>
                  ) : null}
                  {isEditMode ? (
                    <DraggableFlatList
                      data={workoutBlocks}
                      keyExtractor={(item, index) => `${item.id}-${index}`}
                      scrollEnabled={false}
                      contentContainerStyle={styles.previewList}
                      onDragEnd={({ data }) => reorderBlocks(data)}
                      renderItem={renderWorkoutBlock}
                    />
                  ) : (
                    <View style={styles.previewList}>
                      {workoutBlocks.map((block, index) => (
                        <WorkoutBlockCard
                          key={`${block.id}-${index}`}
                          block={block}
                          isEditMode={false}
                          isExpanded={false}
                          getSetCount={getExerciseSetCount}
                          onToggleExpand={() => toggleSupersetExpanded(block.id)}
                          onAddExerciseToSuperset={() => addExerciseToSuperset(block)}
                          onDeleteSuperset={() => openRemoveSuperset(block)}
                          onOpenMenu={() => undefined}
                          onReorderSupersetExercises={() => undefined}
                        />
                      ))}
                    </View>
                  )}
                </View>
              </ScrollView>
            )}
            {resumeRequested && resumeChecking ? null : (
              <View style={styles.previewFooter}>
                <Pressable
                  accessibilityRole="button"
                  style={({ pressed }) => [styles.primaryBtn, pressed && styles.btnPressed]}
                  onPress={() => void startWorkout()}
                >
                  <Text style={styles.primaryBtnText}>Start Workout</Text>
                </Pressable>
              </View>
            )}
          </View>
        ) : mode === 'done' ? (
          <View style={styles.card}>
            <Text style={styles.cardTitle}>Block Complete</Text>
            <Text style={styles.cardMuted}>Nice work. Here’s what you logged:</Text>
            <CompletedSetsList
              logs={logs}
              onEdit={startEditLog}
              itemLabel={isSupersetBlock ? 'Round' : 'Set'}
            />
            <Pressable
              accessibilityRole="button"
              style={({ pressed }) => [styles.primaryBtn, pressed && styles.btnPressed]}
              onPress={isLastBlock ? completeWorkout : goToNextBlock}
            >
              <Text style={styles.primaryBtnText}>
                {!isLastBlock ? 'Next Block' : 'Complete Workout'}
              </Text>
            </Pressable>
          </View>
        ) : (
          <ScrollView
            contentContainerStyle={styles.liftingScrollContent}
            showsVerticalScrollIndicator={false}
          >
            <SetInputCard
              targetLine={targetLine}
              lastLog={lastLog}
              weight={weight}
              reps={reps}
              onChangeWeight={(value) => setWeight(clamp(value, 0, 500))}
              onChangeReps={(value) => setReps(clamp(value, 0, 100))}
              onCompleteSet={completeSet}
              onSkipExercise={confirmSkipExercise}
              skipLabel={isSupersetBlock ? 'Skip Superset' : 'Skip Exercise'}
            />
            <CompletedSetsList
              logs={logs}
              onEdit={startEditLog}
              itemLabel={isSupersetBlock ? 'Round' : 'Set'}
            />
          </ScrollView>
        )}

        <Modal transparent={false} visible={mode === 'rest'} animationType="slide">
          <RestTimerScreen
            nextSetLabel={restNextLabel}
            remainingSeconds={restRemaining}
            totalSeconds={restTotal}
            lastLog={lastLog}
            restFinished={restFinished}
            onAddRest={addRest}
            onSkipRest={skipRest}
            onStartNextSet={handleRestAdvance}
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
        <Modal transparent visible={!!overflowMenu} animationType="fade">
          <View style={styles.sheetOverlay}>
            <View style={styles.sheetCard}>
              <Text style={styles.editTitle}>Exercise options</Text>
              <Pressable
                accessibilityRole="button"
                style={({ pressed }) => [styles.overflowAction, pressed && styles.btnPressed]}
                onPress={() => handleOverflowAction('swap')}
              >
                <Text style={styles.overflowActionText}>Swap</Text>
              </Pressable>
              <Pressable
                accessibilityRole="button"
                style={({ pressed }) => [styles.overflowAction, pressed && styles.btnPressed]}
                onPress={() => handleOverflowAction('edit-sets')}
              >
                <Text style={styles.overflowActionText}>Edit sets</Text>
              </Pressable>
              <Pressable
                accessibilityRole="button"
                style={({ pressed }) => [styles.overflowAction, pressed && styles.btnPressed]}
                onPress={() => handleOverflowAction('remove')}
              >
                <Text style={styles.overflowActionText}>
                  {overflowMenu?.kind === 'superset-item'
                    ? 'Remove from superset'
                    : 'Remove exercise'}
                </Text>
              </Pressable>
              <View style={styles.editActions}>
                <Pressable
                  accessibilityRole="button"
                  style={({ pressed }) => [styles.editBtn, pressed && styles.btnPressed]}
                  onPress={closeOverflowMenu}
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
              <Text style={styles.editTitle}>
                {isSupersetBlock ? 'Skip superset?' : 'Skip exercise?'}
              </Text>
              <Text style={styles.cardMuted}>
                You’ll move to the next block without finishing all sets.
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
                This removes it from today&apos;s workout preview only.
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
        <Modal transparent visible={!!removeSupersetCandidate} animationType="fade">
          <View style={styles.editOverlay}>
            <View style={styles.editCard}>
              <Text style={styles.editTitle}>Delete superset?</Text>
              <Text style={styles.cardMuted}>
                This removes the entire superset from today&apos;s workout preview.
              </Text>
              <View style={styles.editActions}>
                <Pressable
                  accessibilityRole="button"
                  style={({ pressed }) => [styles.editBtn, pressed && styles.btnPressed]}
                  onPress={closeRemoveSuperset}
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
                  onPress={confirmRemoveSuperset}
                >
                  <Text style={styles.editBtnText}>Delete</Text>
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
  exerciseSuperset: {
    fontSize: 12,
    fontWeight: '700',
    color: 'rgba(255,255,255,0.75)',
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
  liftingScrollContent: {
    paddingBottom: 24,
  },
  previewLoadingRow: {
    marginTop: 16,
    alignItems: 'flex-start',
  },
  previewHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  previewTitle: { fontSize: 18, fontWeight: '900', color: '#FFFFFF' },
  previewEditToggle: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 12,
    backgroundColor: 'rgba(37,99,235,0.22)',
    borderWidth: 1,
    borderColor: 'rgba(37,99,235,0.6)',
  },
  previewEditToggleText: { fontSize: 12, fontWeight: '800', color: '#FFFFFF' },
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
  previewSupersetCard: {
    padding: 12,
    borderRadius: 16,
    backgroundColor: 'rgba(255,255,255,0.05)',
    borderWidth: 0.5,
    borderColor: 'rgba(255,255,255,0.08)',
    gap: 10,
  },
  previewSupersetHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  previewSupersetHeaderLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    flex: 1,
  },
  previewSupersetLabel: {
    fontSize: 13,
    fontWeight: '900',
    color: 'rgba(255,255,255,0.75)',
  },
  previewSupersetList: {
    gap: 8,
  },
  previewSupersetItem: {
    fontSize: 14,
    fontWeight: '800',
    color: '#FFFFFF',
  },
  previewRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 16,
    backgroundColor: 'rgba(255,255,255,0.05)',
    borderWidth: 0.5,
    borderColor: 'rgba(255,255,255,0.08)',
  },
  previewRowLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
    gap: 8,
  },
  previewRowEdit: {
    paddingVertical: 12,
  },
  previewRowInline: {
    paddingVertical: 8,
    paddingHorizontal: 10,
    marginLeft: 14,
    backgroundColor: 'rgba(255,255,255,0.03)',
    borderWidth: 0,
  },
  previewRowInlineDivider: {
    borderTopWidth: 0.5,
    borderColor: 'rgba(255,255,255,0.08)',
  },
  dragActiveRow: {
    opacity: 0.85,
  },
  dragHandle: {
    paddingRight: 4,
  },
  previewRowText: { flex: 1, minWidth: 0 },
  previewActions: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  previewName: { fontSize: 14, fontWeight: '900', color: '#FFFFFF' },
  previewMeta: {
    fontSize: 12,
    fontWeight: '700',
    color: 'rgba(255,255,255,0.6)',
    marginTop: 4,
  },
  previewIconBtn: {
    paddingVertical: 6,
    paddingHorizontal: 8,
    borderRadius: 12,
    backgroundColor: 'rgba(255,255,255,0.12)',
    borderWidth: 0.5,
    borderColor: 'rgba(255,255,255,0.2)',
  },
  previewOverflowBtn: {
    paddingVertical: 6,
    paddingHorizontal: 8,
    borderRadius: 12,
    backgroundColor: 'rgba(255,255,255,0.1)',
  },
  supersetFooter: {
    marginTop: 10,
    gap: 6,
  },
  supersetFooterDivider: {
    height: 1,
    backgroundColor: 'rgba(255,255,255,0.08)',
  },
  supersetFooterButton: {
    paddingVertical: 10,
    borderRadius: 12,
    alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.1)',
    borderWidth: 0.5,
    borderColor: 'rgba(255,255,255,0.2)',
  },
  supersetFooterButtonDanger: {
    backgroundColor: 'rgba(239,68,68,0.2)',
    borderColor: 'rgba(239,68,68,0.6)',
  },
  supersetFooterText: {
    fontSize: 12,
    fontWeight: '800',
    color: '#FFFFFF',
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
  restHeader: { alignItems: 'center', paddingTop: 28 },
  restTitle: { fontSize: 20, fontWeight: '900', color: '#FFFFFF' },
  restSubtitle: {
    fontSize: 14,
    fontWeight: '700',
    color: 'rgba(255,255,255,0.75)',
    marginTop: 6,
  },
  restCenterSection: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    gap: 18,
  },
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
    flexWrap: 'wrap',
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
  restFooterActions: {
    marginTop: 'auto',
  },
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
  keyboardAccessory: {
    backgroundColor: '#0B1220',
    borderTopWidth: 1,
    borderColor: 'rgba(255,255,255,0.12)',
    paddingHorizontal: 16,
    paddingVertical: 8,
    alignItems: 'flex-end',
  },
  keyboardDoneBtn: {
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: 10,
    backgroundColor: 'rgba(37,99,235,0.24)',
    borderWidth: 0.5,
    borderColor: 'rgba(37,99,235,0.55)',
  },
  keyboardDoneText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '800',
  },
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
  sheetOverlay: {
    flex: 1,
    backgroundColor: 'rgba(6,10,18,0.72)',
    justifyContent: 'flex-end',
    padding: 24,
  },
  sheetCard: {
    width: '100%',
    borderRadius: 18,
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
