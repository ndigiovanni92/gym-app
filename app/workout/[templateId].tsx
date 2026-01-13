import { useLocalSearchParams } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { supabase } from '@/src/lib/supabase';

type TemplateExercise = {
  id: string;
  sets?: number | null;
  reps?: number | null;
  rep_range?: string | null;
  reps_min?: number | null;
  reps_max?: number | null;
  exercises?: {
    name?: string | null;
    title?: string | null;
  } | null;
  [key: string]: unknown;
};

type WorkoutTemplate = {
  id: string;
  name?: string | null;
  workout_template_exercises?: TemplateExercise[] | null;
};

type SetEntry = {
  key: string;
  templateExerciseId: string;
  setIndex: number;
  prescribedReps: string | null;
  prescribedWeight: number | null;
  actualReps: string;
  actualWeight: string;
  completed: boolean;
};

const resolveNumericOrder = (exercise: TemplateExercise) => {
  const candidate =
    exercise.order_index ??
    exercise.sort_order ??
    exercise.position ??
    exercise.sequence ??
    exercise.order;

  return typeof candidate === 'number' ? candidate : null;
};

const resolveTargetWeight = (exercise: TemplateExercise) => {
  const candidate =
    exercise.target_weight ??
    exercise.prescribed_weight ??
    exercise.weight ??
    exercise.load ??
    exercise.target_load;
  return typeof candidate === 'number' ? candidate : null;
};

const resolveSetCount = (exercise: TemplateExercise) => {
  const candidate =
    exercise.sets ??
    exercise.set_count ??
    exercise.sets_count ??
    exercise.total_sets ??
    exercise.total_set_count;

  return typeof candidate === 'number' && candidate > 0 ? candidate : null;
};

const resolveRepsDisplay = (exercise: TemplateExercise) => {
  const reps =
    typeof exercise.reps === 'number'
      ? exercise.reps
      : typeof exercise.rep_count === 'number'
        ? exercise.rep_count
        : null;
  const repsMin =
    typeof exercise.reps_min === 'number'
      ? exercise.reps_min
      : typeof exercise.rep_min === 'number'
        ? exercise.rep_min
        : null;
  const repsMax =
    typeof exercise.reps_max === 'number'
      ? exercise.reps_max
      : typeof exercise.rep_max === 'number'
        ? exercise.rep_max
        : null;
  const repRange = typeof exercise.rep_range === 'string' ? exercise.rep_range : null;

  if (reps !== null) {
    return `${reps}`;
  }
  if (repRange) {
    return repRange;
  }
  if (repsMin !== null || repsMax !== null) {
    const min = repsMin !== null ? `${repsMin}` : '';
    const max = repsMax !== null ? `${repsMax}` : '';
    return [min, max].filter(Boolean).join('-');
  }
  return null;
};

const formatPrescription = (exercise: TemplateExercise) => {
  const sets = resolveSetCount(exercise);
  const repsDisplay = resolveRepsDisplay(exercise);

  if (sets !== null && repsDisplay) {
    return `${sets} × ${repsDisplay}`;
  }
  if (sets !== null) {
    return `${sets} sets`;
  }
  if (repsDisplay) {
    return `${repsDisplay} reps`;
  }
  return 'Prescription not specified';
};

type ExerciseCardProps = {
  index: number;
  exercise: TemplateExercise;
  setEntries: Record<string, SetEntry>;
  onUpdateSet: (key: string, updates: Partial<SetEntry>) => void;
};

function ExerciseCard({ index, exercise, setEntries, onUpdateSet }: ExerciseCardProps) {
  const name = exercise.exercises?.name ?? exercise.exercises?.title ?? `Exercise ${index + 1}`;
  const sets = resolveSetCount(exercise) ?? 1;
  const repsDisplay = resolveRepsDisplay(exercise);
  const targetWeight = resolveTargetWeight(exercise);

  return (
    <View style={styles.exerciseCard}>
      <ThemedText type="defaultSemiBold">
        {index + 1}. {name}
      </ThemedText>
      <ThemedText style={styles.exerciseMeta}>{formatPrescription(exercise)}</ThemedText>
      <View style={styles.setList}>
        {Array.from({ length: sets }).map((_, setIndex) => {
          const key = `${exercise.id}-${setIndex}`;
          const entry = setEntries[key];
          const setLabel = `Set ${setIndex + 1}`;

          return (
            <View key={key} style={[styles.setRow, entry?.completed ? styles.setRowCompleted : null]}>
              <View style={styles.setRowHeader}>
                <ThemedText type="defaultSemiBold">{setLabel}</ThemedText>
                <ThemedText style={styles.setPrescription}>
                  {repsDisplay ? `${repsDisplay} reps` : 'Reps not set'}
                  {targetWeight !== null ? ` • ${targetWeight} lb` : ''}
                </ThemedText>
              </View>
              <View style={styles.setRowInputs}>
                <View style={styles.inputGroup}>
                  <ThemedText style={styles.inputLabel}>Reps</ThemedText>
                  <TextInput
                    style={styles.input}
                    value={entry?.actualReps ?? ''}
                    placeholder="0"
                    keyboardType="numeric"
                    onChangeText={(value) => onUpdateSet(key, { actualReps: value })}
                  />
                </View>
                <View style={styles.inputGroup}>
                  <ThemedText style={styles.inputLabel}>Weight</ThemedText>
                  <TextInput
                    style={styles.input}
                    value={entry?.actualWeight ?? ''}
                    placeholder="0"
                    keyboardType="numeric"
                    onChangeText={(value) => onUpdateSet(key, { actualWeight: value })}
                  />
                </View>
                <Pressable
                  accessibilityRole="checkbox"
                  accessibilityState={{ checked: entry?.completed ?? false }}
                  onPress={() => onUpdateSet(key, { completed: !(entry?.completed ?? false) })}
                  style={[styles.checkbox, entry?.completed ? styles.checkboxChecked : null]}
                >
                  <ThemedText style={styles.checkboxText}>
                    {entry?.completed ? '✓' : ''}
                  </ThemedText>
                </Pressable>
              </View>
            </View>
          );
        })}
      </View>
    </View>
  );
}

export default function WorkoutTemplateScreen() {
  const params = useLocalSearchParams<{ templateId?: string | string[] }>();
  const templateId = Array.isArray(params.templateId) ? params.templateId[0] : params.templateId;
  const [template, setTemplate] = useState<WorkoutTemplate | null>(null);
  const [loading, setLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [setEntries, setSetEntries] = useState<Record<string, SetEntry>>({});
  const [saving, setSaving] = useState(false);
  const [saveMessage, setSaveMessage] = useState<string | null>(null);

  useEffect(() => {
    let isMounted = true;

    const loadTemplate = async () => {
      if (!templateId) {
        setErrorMessage('Missing workout template.');
        setLoading(false);
        return;
      }

      setLoading(true);
      setErrorMessage(null);

      const { data, error } = await supabase
        .from('workout_templates')
        .select('id, name, workout_template_exercises ( *, exercises ( * ) )')
        .eq('id', templateId)
        .maybeSingle();

      if (!isMounted) {
        return;
      }

      if (error) {
        setErrorMessage(error.message);
        setTemplate(null);
      } else {
        setTemplate((data as WorkoutTemplate) ?? null);
      }

      setLoading(false);
    };

    loadTemplate();

    return () => {
      isMounted = false;
    };
  }, [templateId]);

  const orderedExercises = useMemo(() => {
    const exercises = template?.workout_template_exercises ?? [];
    return [...exercises].sort((a, b) => {
      const aOrder = resolveNumericOrder(a);
      const bOrder = resolveNumericOrder(b);

      if (aOrder !== null && bOrder !== null) {
        return aOrder - bOrder;
      }
      if (aOrder !== null) {
        return -1;
      }
      if (bOrder !== null) {
        return 1;
      }
      return 0;
    });
  }, [template?.workout_template_exercises]);

  useEffect(() => {
    if (orderedExercises.length === 0) {
      setSetEntries({});
      return;
    }

    const nextEntries: Record<string, SetEntry> = {};
    orderedExercises.forEach((exercise) => {
      const sets = resolveSetCount(exercise) ?? 1;
      const repsDisplay = resolveRepsDisplay(exercise);
      const targetWeight = resolveTargetWeight(exercise);

      Array.from({ length: sets }).forEach((_, setIndex) => {
        const key = `${exercise.id}-${setIndex}`;
        nextEntries[key] = {
          key,
          templateExerciseId: exercise.id,
          setIndex,
          prescribedReps: repsDisplay,
          prescribedWeight: targetWeight,
          actualReps: '',
          actualWeight: '',
          completed: false,
        };
      });
    });
    setSetEntries(nextEntries);
  }, [orderedExercises]);

  const completedSetCount = useMemo(
    () => Object.values(setEntries).filter((entry) => entry.completed).length,
    [setEntries],
  );

  const handleUpdateSet = (key: string, updates: Partial<SetEntry>) => {
    setSetEntries((prev) => {
      const current = prev[key];
      if (!current) {
        return prev;
      }
      return {
        ...prev,
        [key]: { ...current, ...updates },
      };
    });
  };

  const handleFinishWorkout = async () => {
    if (!templateId || saving || completedSetCount === 0) {
      return;
    }

    setSaving(true);
    setErrorMessage(null);
    setSaveMessage(null);

    const { data: sessionData, error: sessionError } = await supabase
      .from('workout_sessions')
      .insert({
        workout_template_id: templateId,
        started_at: new Date().toISOString(),
        status: "in_progress",
        
      })
      .select('id')
      .single();

    if (sessionError || !sessionData) {
      setErrorMessage(sessionError?.message ?? 'Unable to start workout session.');
      setSaving(false);
      return;
    }

    const payload = Object.values(setEntries)
      .filter((entry) => entry.completed)
      .map((entry) => ({
        workout_session_id: sessionData.id,
        workout_template_exercise_id: entry.templateExerciseId,
        set_number: entry.setIndex + 1,
        reps: entry.actualReps ? Number(entry.actualReps) : null,
        weight: entry.actualWeight ? Number(entry.actualWeight) : null,
      }));

    const { error: logError } = await supabase.from('set_logs').insert(payload);

    if (logError) {
      setErrorMessage(logError.message);
      setSaving(false);
      return;
    }

    setSaveMessage('Workout saved! Nice work.');
    setSaving(false);
  };

  return (
    <ThemedView style={styles.container}>
      <View style={styles.header}>
        <ThemedText type="title">{template?.name ?? 'Workout'}</ThemedText>
        <ThemedText type="subtitle">Template {templateId ?? 'Unknown'}</ThemedText>
      </View>
      {loading ? (
        <ActivityIndicator size="large" />
      ) : errorMessage ? (
        <ThemedText style={styles.errorText}>{errorMessage}</ThemedText>
      ) : orderedExercises.length === 0 ? (
        <ThemedText>No exercises found for this workout.</ThemedText>
      ) : (
        <>
          <ScrollView contentContainerStyle={styles.exerciseList}>
            {saveMessage ? <ThemedText style={styles.successText}>{saveMessage}</ThemedText> : null}
            {orderedExercises.map((exercise, index) => (
              <ExerciseCard
                key={exercise.id}
                index={index}
                exercise={exercise}
                setEntries={setEntries}
                onUpdateSet={handleUpdateSet}
              />
            ))}
          </ScrollView>
          <View style={styles.footer}>
            <Pressable
              onPress={handleFinishWorkout}
              disabled={saving || completedSetCount === 0}
              style={[
                styles.finishButton,
                saving || completedSetCount === 0 ? styles.finishButtonDisabled : null,
              ]}
            >
              <ThemedText style={styles.finishButtonText}>
                {saving ? 'Saving...' : `Finish Workout (${completedSetCount})`}
              </ThemedText>
            </Pressable>
          </View>
        </>
      )}
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    padding: 24,
    gap: 16,
  },
  header: {
    gap: 8,
  },
  exerciseList: {
    gap: 12,
    paddingBottom: 140,
  },
  exerciseCard: {
    padding: 16,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#e4e4e7',
    backgroundColor: '#fff',
    gap: 6,
  },
  exerciseMeta: {
    color: '#6b7280',
  },
  setList: {
    gap: 12,
    marginTop: 8,
  },
  setRow: {
    padding: 12,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#e5e7eb',
    backgroundColor: '#f9fafb',
    gap: 10,
  },
  setRowCompleted: {
    borderColor: '#22c55e',
    backgroundColor: '#f0fdf4',
  },
  setRowHeader: {
    gap: 4,
  },
  setPrescription: {
    color: '#6b7280',
  },
  setRowInputs: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  inputGroup: {
    flex: 1,
    gap: 4,
  },
  inputLabel: {
    color: '#6b7280',
    fontSize: 12,
  },
  input: {
    borderWidth: 1,
    borderColor: '#d1d5db',
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 8,
    backgroundColor: '#fff',
  },
  checkbox: {
    width: 36,
    height: 36,
    borderRadius: 18,
    borderWidth: 2,
    borderColor: '#9ca3af',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#fff',
  },
  checkboxChecked: {
    borderColor: '#22c55e',
    backgroundColor: '#22c55e',
  },
  checkboxText: {
    color: '#fff',
    fontSize: 18,
  },
  footer: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    padding: 16,
    backgroundColor: '#fff',
    borderTopWidth: 1,
    borderTopColor: '#e5e7eb',
  },
  finishButton: {
    backgroundColor: '#111827',
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: 'center',
  },
  finishButtonDisabled: {
    backgroundColor: '#9ca3af',
  },
  finishButtonText: {
    color: '#fff',
    fontSize: 16,
  },
  errorText: {
    color: '#dc2626',
  },
  successText: {
    color: '#16a34a',
    fontWeight: '600',
  },
});
