import { useLocalSearchParams } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { supabase } from '@/src/lib/supabase';

type Program = {
  id: string;
  title?: string | null;
  description?: string | null;
};

type ProgramSchedule = {
  id: string;
  week_number?: number | null;
  day_number?: number | null;
  sort_order?: number | null;
  workout_template_id?: string | null;
};

type WorkoutTemplate = {
  id: string;
  name?: string | null;
  notes?: string | null;
  target_duration_min?: number | null;
};

export default function ProgramDetailsScreen() {
  const params = useLocalSearchParams<{ programId?: string | string[] }>();
  const programId = Array.isArray(params.programId) ? params.programId[0] : params.programId;
  const [program, setProgram] = useState<Program | null>(null);
  const [schedule, setSchedule] = useState<ProgramSchedule[]>([]);
  const [templates, setTemplates] = useState<WorkoutTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const templateById = useMemo(() => {
    return new Map(templates.map((template) => [template.id, template]));
  }, [templates]);

  const scheduleByWeek = useMemo(() => {
    const groups = new Map<number, ProgramSchedule[]>();
    schedule.forEach((item) => {
      const week = item.week_number ?? 0;
      const existing = groups.get(week) ?? [];
      existing.push(item);
      groups.set(week, existing);
    });
    return Array.from(groups.entries()).sort(([a], [b]) => a - b);
  }, [schedule]);

  useEffect(() => {
    let isMounted = true;

    const loadProgram = async () => {
      if (!programId) {
        return;
      }
      setLoading(true);
      setErrorMessage(null);

      const { data: programData, error: programError } = await supabase
        .from('programs')
        .select('id, title, description')
        .eq('id', programId)
        .maybeSingle();

      if (!isMounted) {
        return;
      }

      if (programError) {
        setErrorMessage(programError.message);
        setProgram(null);
        setLoading(false);
        return;
      }

      setProgram((programData as Program | null) ?? null);

      const { data: scheduleData, error: scheduleError } = await supabase
        .from('program_schedule')
        .select('id, week_number, day_number, sort_order, workout_template_id')
        .eq('program_id', programId)
        .order('week_number', { ascending: true })
        .order('day_number', { ascending: true });

      if (!isMounted) {
        return;
      }

      if (scheduleError) {
        setErrorMessage(scheduleError.message);
        setSchedule([]);
        setLoading(false);
        return;
      }

      setSchedule((scheduleData as ProgramSchedule[]) ?? []);

      const { data: templateData, error: templateError } = await supabase
        .from('workout_templates')
        .select('id, name, notes, target_duration_min')
        .eq('program_id', programId)
        .order('id', { ascending: true });

      if (!isMounted) {
        return;
      }

      if (templateError) {
        setErrorMessage(templateError.message);
        setTemplates([]);
      } else {
        setTemplates((templateData as WorkoutTemplate[]) ?? []);
      }

      setLoading(false);
    };

    void loadProgram();

    return () => {
      isMounted = false;
    };
  }, [programId]);

  return (
    <SafeAreaView style={styles.safeArea} edges={['left', 'right', 'bottom']}>
      <ScrollView
        contentContainerStyle={styles.container}
        contentInsetAdjustmentBehavior="never"
      >
        {loading ? (
          <ActivityIndicator size="large" />
        ) : errorMessage ? (
          <ThemedText style={styles.errorText}>{errorMessage}</ThemedText>
        ) : !program ? (
          <ThemedText style={styles.emptyText}>Program not found.</ThemedText>
        ) : (
          <>
            <View style={styles.header}>
              <ThemedText type="title">{program.title ?? 'Program'}</ThemedText>
              {program.description ? (
                <ThemedText style={styles.description}>{program.description}</ThemedText>
              ) : null}
            </View>

            <View style={styles.section}>
              <ThemedText type="defaultSemiBold">Schedule</ThemedText>
              {scheduleByWeek.length === 0 ? (
                <ThemedText style={styles.emptyText}>No schedule available.</ThemedText>
              ) : (
                scheduleByWeek.map(([week, items]) => (
                  <View key={`week-${week}`} style={styles.weekBlock}>
                    <View style={styles.weekHeader}>
                      <View style={styles.weekBadge}>
                        <ThemedText style={styles.weekBadgeText}>
                          {week > 0 ? `Week ${week}` : 'Week'}
                        </ThemedText>
                      </View>
                      <ThemedText style={styles.weekCount}>
                        {items.length} workout{items.length === 1 ? '' : 's'}
                      </ThemedText>
                    </View>
                    <View style={styles.weekList}>
                      {items.map((item, index) => {
                        const template = item.workout_template_id
                          ? templateById.get(item.workout_template_id) ?? null
                          : null;
                        const metaParts = [];
                        if (item.sort_order) {
                          metaParts.push(`Workout ${item.sort_order}`);
                        }
                        if (item.day_number) {
                          metaParts.push(`Day ${item.day_number}`);
                        }
                        if (template?.target_duration_min) {
                          metaParts.push(`~${template.target_duration_min} min`);
                        }
                        return (
                          <View
                            key={item.id}
                            style={[
                              styles.scheduleRow,
                              index < items.length - 1 && styles.scheduleRowDivider,
                            ]}
                          >
                            <ThemedText style={styles.scheduleTitle}>
                              {template?.name ?? 'Workout'}
                            </ThemedText>
                            {template?.notes ? (
                              <ThemedText style={styles.scheduleNote}>{template.notes}</ThemedText>
                            ) : null}
                            {metaParts.length > 0 ? (
                              <ThemedText style={styles.scheduleMeta}>
                                {metaParts.join(' \u2022 ')}
                              </ThemedText>
                            ) : null}
                          </View>
                        );
                      })}
                    </View>
                  </View>
                ))
              )}
            </View>
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
  },
  container: {
    paddingHorizontal: 24,
    paddingBottom: 24,
    paddingTop: 12,
    gap: 24,
  },
  header: {
    gap: 8,
    marginTop: 6,
  },
  description: {
    color: '#52525b',
    lineHeight: 20,
  },
  section: {
    gap: 12,
  },
  weekBlock: {
    gap: 12,
    padding: 14,
    borderRadius: 18,
    backgroundColor: '#f8fafc',
    borderWidth: 1,
    borderColor: '#e2e8f0',
  },
  weekHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
  },
  weekBadge: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: '#111827',
  },
  weekBadgeText: {
    color: '#ffffff',
    fontSize: 12,
    fontWeight: '700',
  },
  weekCount: {
    color: '#64748b',
    fontSize: 12,
    fontWeight: '600',
  },
  weekList: {
    backgroundColor: '#ffffff',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    overflow: 'hidden',
  },
  scheduleRow: {
    padding: 12,
    gap: 4,
  },
  scheduleRowDivider: {
    borderBottomWidth: 1,
    borderColor: '#e2e8f0',
  },
  scheduleTitle: {
    fontSize: 14,
    fontWeight: '700',
  },
  scheduleNote: {
    color: '#71717a',
    fontSize: 12,
  },
  scheduleMeta: {
    color: '#64748b',
    fontSize: 12,
  },
  emptyText: {
    color: '#6b7280',
  },
  errorText: {
    color: '#dc2626',
  },
});
