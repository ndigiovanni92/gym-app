import { Link } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { supabase } from '@/src/lib/supabase';

type ActiveProgram = {
  id: string;
  program_id: string;
  programs?: {
    id: string;
    title?: string | null;
  } | null;
};

type WorkoutTemplate = {
  id: string;
  name?: string | null;
  title?: string | null;
};

export default function TodayScreen() {
  const [activeProgram, setActiveProgram] = useState<ActiveProgram | null>(null);
  const [templates, setTemplates] = useState<WorkoutTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    let isMounted = true;

    const loadToday = async () => {
      setLoading(true);
      setErrorMessage(null);

      const { data: programData, error: programError } = await supabase
        .from('user_programs')
        .select('id, program_id, programs ( id, title )')
        .eq('active', true)
        .maybeSingle();

      if (!isMounted) {
        return;
      }

      if (programError) {
        setErrorMessage(programError.message);
        setActiveProgram(null);
        setTemplates([]);
        setLoading(false);
        return;
      }

      if (!programData) {
        setActiveProgram(null);
        setTemplates([]);
        setLoading(false);
        return;
      }

      setActiveProgram(programData as ActiveProgram);

      const { data: templateData, error: templateError } = await supabase
        .from('workout_templates')
        .select('*')
        .eq('program_id', programData.program_id)
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

    loadToday();

    return () => {
      isMounted = false;
    };
  }, []);

  return (
    <ThemedView style={styles.container}>
      <View style={styles.header}>
        <ThemedText type="title">Today</ThemedText>
        <ThemedText type="subtitle">Your next workout is ready.</ThemedText>
      </View>

      {loading ? (
        <ActivityIndicator size="large" />
      ) : errorMessage ? (
        <ThemedText style={styles.errorText}>{errorMessage}</ThemedText>
      ) : !activeProgram ? (
        <ThemedText>No active program found.</ThemedText>
      ) : (
        <View style={styles.content}>
          <View style={styles.programCard}>
            <ThemedText type="defaultSemiBold">Active Program</ThemedText>
            <ThemedText style={styles.programName}>
              {activeProgram.programs?.title ?? 'Your Program'}
            </ThemedText>
          </View>

          <View style={styles.section}>
            <ThemedText type="defaultSemiBold">Today&apos;s Workout</ThemedText>
            {templates.length === 0 ? (
              <ThemedText style={styles.emptyText}>No workout found.</ThemedText>
            ) : (
              <Link
                href={{
                  pathname: '/workout/[templateId]',
                  params: { templateId: templates[0].id },
                }}
                asChild>
                <Pressable style={styles.templateCard}>
                  <ThemedText type="defaultSemiBold">
                    {templates[0].name ?? templates[0].title ?? `Template ${templates[0].id}`}
                  </ThemedText>
                  <ThemedText style={styles.templateCta}>View workout →</ThemedText>
                </Pressable>
              </Link>
            )}
          </View>
        </View>
      )}
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    padding: 24,
    gap: 24,
  },
  header: {
    gap: 8,
  },
  content: {
    gap: 24,
  },
  programCard: {
    padding: 16,
    borderRadius: 16,
    backgroundColor: '#f4f4f5',
    gap: 4,
  },
  programName: {
    fontSize: 18,
  },
  section: {
    gap: 12,
  },
  templateCard: {
    padding: 16,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#e4e4e7',
    backgroundColor: '#fff',
    gap: 8,
  },
  templateCta: {
    color: '#2563eb',
  },
  emptyText: {
    color: '#6b7280',
  },
  errorText: {
    color: '#dc2626',
  },
});
