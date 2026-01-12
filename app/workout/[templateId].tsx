import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, View } from 'react-native';
import { useLocalSearchParams } from 'expo-router';

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

const resolveNumericOrder = (exercise: TemplateExercise) => {
  const candidate =
    exercise.order_index ??
    exercise.sort_order ??
    exercise.position ??
    exercise.sequence ??
    exercise.order;

  return typeof candidate === 'number' ? candidate : null;
};

const formatPrescription = (exercise: TemplateExercise) => {
  const sets =
    typeof exercise.sets === 'number'
      ? exercise.sets
      : typeof exercise.set_count === 'number'
        ? exercise.set_count
        : typeof exercise.sets_count === 'number'
          ? exercise.sets_count
          : null;
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

  let repsDisplay: string | null = null;
  if (reps !== null) {
    repsDisplay = `${reps}`;
  } else if (repRange) {
    repsDisplay = repRange;
  } else if (repsMin !== null || repsMax !== null) {
    const min = repsMin !== null ? `${repsMin}` : '';
    const max = repsMax !== null ? `${repsMax}` : '';
    repsDisplay = [min, max].filter(Boolean).join('-');
  }

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
};

function ExerciseCard({ index, exercise }: ExerciseCardProps) {
  const name = exercise.exercises?.name ?? exercise.exercises?.title ?? `Exercise ${index + 1}`;

  return (
    <View style={styles.exerciseCard}>
      <ThemedText type="defaultSemiBold">
        {index + 1}. {name}
      </ThemedText>
      <ThemedText style={styles.exerciseMeta}>{formatPrescription(exercise)}</ThemedText>
    </View>
  );
}

export default function WorkoutTemplateScreen() {
  const params = useLocalSearchParams<{ templateId?: string | string[] }>();
  const templateId = Array.isArray(params.templateId) ? params.templateId[0] : params.templateId;
  const [template, setTemplate] = useState<WorkoutTemplate | null>(null);
  const [loading, setLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

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
        <ScrollView contentContainerStyle={styles.exerciseList}>
          {orderedExercises.map((exercise, index) => (
            <ExerciseCard key={exercise.id} index={index} exercise={exercise} />
          ))}
        </ScrollView>
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
  errorText: {
    color: '#dc2626',
  },
});
