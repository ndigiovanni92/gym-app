import { Link } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Modal,
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  View,
} from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { supabase } from '@/src/lib/supabase';

type ActiveProgram = {
  id: string;
  program_id: string;
  programs?: {
    id: string;
    title?: string | null;
    description?: string | null;
  } | null;
};

type WorkoutTemplate = {
  id: string;
  name?: string | null;
  notes?: string | null;
  target_duration_min?: number | null;
};

type ProgramProgress = {
  next_program_schedule_id?: string | null;
};

type ActiveSession = {
  id: string;
  workout_template_id?: string | null;
};

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

export default function TodayScreen() {
  const [activeProgram, setActiveProgram] = useState<ActiveProgram | null>(null);
  const [schedules, setSchedules] = useState<ProgramSchedule[]>([]);
  const [nextScheduleId, setNextScheduleId] = useState<string | null>(null);
  const [templates, setTemplates] = useState<WorkoutTemplate[]>([]);
  const [activeSession, setActiveSession] = useState<ActiveSession | null>(null);
  const [programs, setPrograms] = useState<Program[]>([]);
  const [enrollingProgramId, setEnrollingProgramId] = useState<string | null>(null);
  const [userId, setUserId] = useState<string | null>(null);
  const [showProgramAbout, setShowProgramAbout] = useState(false);
  const [showSwitchWorkout, setShowSwitchWorkout] = useState(false);
  const [showEndProgram, setShowEndProgram] = useState(false);
  const [loading, setLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const templateById = useMemo(() => {
    return new Map(templates.map((template) => [template.id, template]));
  }, [templates]);
  const totalWorkouts = schedules.length;
  const todayIndex = totalWorkouts > 0 ? 1 : 0;
  const nextSchedule =
    nextScheduleId ? schedules.find((schedule) => schedule.id === nextScheduleId) : null;
  const nextTemplate = nextSchedule?.workout_template_id
    ? templateById.get(nextSchedule.workout_template_id) ?? null
    : null;
  const weekNumber = nextSchedule?.week_number ?? null;
  const workoutSortOrder = nextSchedule?.sort_order ?? null;
  const totalWeeksFromSchedules = schedules.reduce<number>((maxWeek, schedule) => {
    const candidate = schedule.week_number ?? null;
    if (typeof candidate === 'number' && Number.isFinite(candidate)) {
      return Math.max(maxWeek, candidate);
    }
    return maxWeek;
  }, 0);
  const programTitle = activeProgram?.programs?.title ?? '';
  const totalWeeksFromTitleMatch = programTitle.match(/(\d+)\s*-?\s*week/i);
  const totalWeeksFromTitle = totalWeeksFromTitleMatch
    ? Number(totalWeeksFromTitleMatch[1])
    : 0;
  const totalWeeks = totalWeeksFromSchedules || totalWeeksFromTitle;
  const totalWorkoutsInProgram =
    schedules.reduce<number>((maxSort, schedule) => {
      const candidate = schedule.sort_order ?? null;
      if (typeof candidate === 'number' && Number.isFinite(candidate)) {
        return Math.max(maxSort, candidate);
      }
      return maxSort;
    }, 0) || totalWorkouts;
  const overallWorkoutIndex = workoutSortOrder ?? todayIndex;
  const progressSummary = [
    totalWorkoutsInProgram
      ? `Workout ${overallWorkoutIndex} of ${totalWorkoutsInProgram}`
      : null,
    weekNumber && totalWeeks ? `Week ${weekNumber} of ${totalWeeks}` : null,
  ]
    .filter(Boolean)
    .join(' \u2022 ');
  const programProgress =
    totalWorkoutsInProgram > 0
      ? Math.min(1, Math.max(0, overallWorkoutIndex / totalWorkoutsInProgram))
      : 0;
  const programDescription = activeProgram?.programs?.description ?? '';
  const upNextTitle = nextTemplate
    ? `${nextTemplate.name ?? 'Workout'}${nextTemplate.notes ? ` — ${nextTemplate.notes}` : ''}`
    : 'No workout scheduled';
  const upNextMeta = nextTemplate
    ? [
        nextTemplate.name ? `Focus: ${nextTemplate.name}` : null,
        nextTemplate.target_duration_min
          ? `~${nextTemplate.target_duration_min} min`
          : null,
      ]
        .filter(Boolean)
        .join(' \u2022 ')
    : null;
  const canResume =
    !!activeSession?.workout_template_id &&
    (!!nextTemplate?.id ? activeSession.workout_template_id === nextTemplate.id : true);
  const primaryCtaTemplateId = canResume
    ? activeSession?.workout_template_id ?? null
    : nextTemplate?.id ?? null;
  const primaryCtaLabel = canResume ? 'Resume workout' : 'Start workout';

  const loadToday = useCallback(async () => {
    setLoading(true);
    setErrorMessage(null);

    const { data: userData } = await supabase.auth.getUser();
    const nextUserId = userData?.user?.id ?? null;
    setUserId(nextUserId);

    if (!nextUserId) {
      setActiveProgram(null);
      setSchedules([]);
      setNextScheduleId(null);
      setTemplates([]);
      setPrograms([]);
      setLoading(false);
      return;
    }

    const { data: programData, error: programError } = await supabase
      .from('user_programs')
      .select('id, program_id, programs ( id, title, description )')
      .eq('active', true)
      .eq('user_id', nextUserId)
      .maybeSingle();

    if (programError) {
      setErrorMessage(programError.message);
      setActiveProgram(null);
      setSchedules([]);
      setNextScheduleId(null);
      setTemplates([]);
      setPrograms([]);
      setLoading(false);
      return;
    }

    if (!programData) {
      setActiveProgram(null);
      setSchedules([]);
      setNextScheduleId(null);
      setTemplates([]);

      const { data: programList, error: listError } = await supabase
        .from('programs')
        .select('id, title, description')
        .order('title', { ascending: true });

      if (listError) {
        setErrorMessage(listError.message);
        setPrograms([]);
      } else {
        setPrograms((programList as Program[]) ?? []);
      }

      setLoading(false);
      return;
    }

    setActiveProgram(programData as ActiveProgram);
    setShowProgramAbout(false);
    setShowSwitchWorkout(false);

    const { data: progressData } = await supabase
      .from('user_program_progress')
      .select('next_program_schedule_id')
      .eq('user_program_id', programData.id)
      .maybeSingle();

    const progress = (progressData as ProgramProgress | null) ?? null;
    setNextScheduleId(progress?.next_program_schedule_id ?? null);

    const { data: scheduleList, error: scheduleListError } = await supabase
      .from('program_schedule')
      .select('id, week_number, day_number, sort_order, workout_template_id')
      .eq('program_id', programData.program_id)
      .order('week_number', { ascending: true })
      .order('day_number', { ascending: true });

    if (scheduleListError) {
      setErrorMessage(scheduleListError.message);
      setSchedules([]);
    } else {
      setSchedules((scheduleList as ProgramSchedule[]) ?? []);
    }

    const { data: sessionData } = await supabase
      .from('workout_sessions')
      .select('id, workout_template_id')
      .eq('user_program_id', programData.id)
      .is('completed_at', null)
      .order('started_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    setActiveSession((sessionData as ActiveSession | null) ?? null);

    const { data: templateList, error: templateError } = await supabase
      .from('workout_templates')
      .select('id, name, notes, target_duration_min')
      .eq('program_id', programData.program_id)
      .order('id', { ascending: true });

    if (templateError) {
      setErrorMessage(templateError.message);
      setTemplates([]);
    } else {
      setTemplates((templateList as WorkoutTemplate[]) ?? []);
    }

    setLoading(false);
  }, []);

  useEffect(() => {
    void loadToday();
  }, [loadToday]);

  const enrollInProgram = async (program: Program) => {
    if (!userId) {
      setErrorMessage('Please sign in to enroll in a program.');
      return;
    }

    setEnrollingProgramId(program.id);
    setErrorMessage(null);

    await supabase.from('user_programs').update({ active: false }).eq('user_id', userId);

    const { data: existingEnrollment, error: updateError } = await supabase
      .from('user_programs')
      .update({ active: true })
      .eq('user_id', userId)
      .eq('program_id', program.id)
      .select('id')
      .maybeSingle();

    let enrollmentId = (existingEnrollment as { id?: string } | null)?.id ?? null;

    if (!enrollmentId && !updateError) {
      const { data: enrollmentData, error: enrollmentError } = await supabase
        .from('user_programs')
        .insert({
          user_id: userId,
          program_id: program.id,
          active: true,
        })
        .select('id')
        .maybeSingle();

      if (enrollmentError) {
        setErrorMessage('Error enrolling in program.');
        setEnrollingProgramId(null);
        await loadToday();
        return;
      }

      enrollmentId = (enrollmentData as { id?: string } | null)?.id ?? null;
    }

    if (updateError) {
      setErrorMessage('Error enrolling in program.');
      setEnrollingProgramId(null);
      await loadToday();
      return;
    }

    const { data: firstSchedule } = await supabase
      .from('program_schedule')
      .select('id, week_number')
      .eq('program_id', program.id)
      .order('week_number', { ascending: true })
      .order('day_number', { ascending: true })
      .limit(1)
      .maybeSingle();

    const nextScheduleId = (firstSchedule as ProgramSchedule | null)?.id ?? null;
    const nextWeek = (firstSchedule as ProgramSchedule | null)?.week_number ?? 1;

    if (enrollmentId && nextScheduleId) {
      await supabase.from('user_program_progress').insert({
        user_program_id: enrollmentId,
        next_program_schedule_id: nextScheduleId,
        current_week: nextWeek,
        updated_at: new Date().toISOString(),
      });
    }

    setEnrollingProgramId(null);
    await loadToday();
  };

  const switchWorkout = async (schedule: ProgramSchedule) => {
    if (!activeProgram) {
      return;
    }

    setErrorMessage(null);

    const { data: updatedRows, error: updateError } = await supabase
      .from('user_program_progress')
      .update({
        next_program_schedule_id: schedule.id,
        current_week: schedule.week_number ?? null,
        updated_at: new Date().toISOString(),
      })
      .eq('user_program_id', activeProgram.id)
      .select('user_program_id');

    if (updateError) {
      setErrorMessage(updateError.message);
      return;
    }

    if (!updatedRows || updatedRows.length === 0) {
      const { error: insertError } = await supabase.from('user_program_progress').insert({
        user_program_id: activeProgram.id,
        next_program_schedule_id: schedule.id,
        current_week: schedule.week_number ?? null,
        updated_at: new Date().toISOString(),
      });

      if (insertError) {
        setErrorMessage(insertError.message);
        return;
      }
    }

    setNextScheduleId(schedule.id);
    setShowSwitchWorkout(false);
  };

  const endProgram = async () => {
    if (!activeProgram || !userId) {
      return;
    }
    setErrorMessage(null);
    const { error } = await supabase
      .from('user_programs')
      .update({ active: false })
      .eq('id', activeProgram.id)
      .eq('user_id', userId);

    if (error) {
      setErrorMessage('Unable to end program.');
      return;
    }

    setShowEndProgram(false);
    await loadToday();
  };

  return (
    <SafeAreaView style={styles.safeArea}>
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
          <View style={styles.content}>
            <View style={styles.programCard}>
              <ThemedText type="defaultSemiBold">No active program</ThemedText>
              <ThemedText style={styles.programMeta}>
                Pick a program to get started.
              </ThemedText>
            </View>
            <View style={styles.section}>
              <ThemedText type="defaultSemiBold">Programs</ThemedText>
              {programs.length === 0 ? (
                <ThemedText style={styles.emptyText}>No programs available.</ThemedText>
              ) : (
                programs.map((program) => (
                  <View key={program.id} style={styles.programRow}>
                    <ThemedText type="defaultSemiBold">
                      {program.title ?? 'Program'}
                    </ThemedText>
                    <Pressable
                      accessibilityRole="button"
                      style={({ pressed }) => [
                        styles.enrollBtn,
                        pressed && styles.btnPressed,
                      ]}
                      onPress={() => void enrollInProgram(program)}
                      disabled={enrollingProgramId === program.id}
                    >
                      <ThemedText style={styles.enrollBtnText}>
                        {enrollingProgramId === program.id ? 'Enrolling...' : 'Enroll'}
                      </ThemedText>
                    </Pressable>
                  </View>
                ))
              )}
            </View>
          </View>
        ) : (
          <View style={styles.content}>
            <View style={styles.programCard}>
              <View style={styles.cardHeaderRow}>
                <View style={styles.cardHeaderText}>
                  <ThemedText style={styles.programTitle}>
                    {activeProgram.programs?.title ?? 'Your Program'}
                  </ThemedText>
                  {programDescription ? (
                    <Pressable
                      accessibilityRole="button"
                      style={({ pressed }) => [
                        styles.aboutToggleRow,
                        pressed && styles.btnPressed,
                      ]}
                      onPress={() => setShowProgramAbout((prev) => !prev)}
                    >
                      <ThemedText style={styles.aboutToggle}>
                        {showProgramAbout ? 'Hide details' : 'About this program'}
                      </ThemedText>
                      <ThemedText style={styles.aboutToggleIcon}>
                        {showProgramAbout ? '▴' : '▾'}
                      </ThemedText>
                    </Pressable>
                  ) : null}
                </View>
              </View>
              {showProgramAbout && programDescription ? (
                <ThemedText style={styles.programDescription}>{programDescription}</ThemedText>
              ) : null}
              {totalWorkouts > 0 ? (
                <View style={styles.progressWrap}>
                  <View style={styles.progressTrack}>
                    <View style={[styles.progressFill, { width: `${programProgress * 100}%` }]} />
                  </View>
                  {progressSummary ? (
                    <ThemedText style={styles.progressLabel}>{progressSummary}</ThemedText>
                  ) : null}
                </View>
              ) : null}
              <View style={styles.cardDivider} />
              <ThemedText style={styles.upNextLabel}>Up next:</ThemedText>
              <ThemedText style={styles.upNextTitle}>{upNextTitle}</ThemedText>
              {upNextMeta ? (
                <ThemedText style={styles.upNextMeta}>{upNextMeta}</ThemedText>
              ) : null}
              {primaryCtaTemplateId ? (
                <Link
                  href={{
                    pathname: '/workout/[templateId]',
                    params: { templateId: primaryCtaTemplateId },
                  }}
                  asChild>
                  <Pressable style={styles.primaryCta}>
                    <ThemedText style={styles.primaryCtaText}>{primaryCtaLabel}</ThemedText>
                  </Pressable>
                </Link>
              ) : (
                <Pressable style={[styles.primaryCta, styles.primaryCtaDisabled]} disabled>
                  <ThemedText style={styles.primaryCtaText}>Start workout</ThemedText>
                </Pressable>
              )}
              <View style={styles.secondaryActions}>
                <Link
                  href={{
                    pathname: '/program/[programId]',
                    params: { programId: activeProgram.program_id },
                  }}
                  asChild>
                  <Pressable style={styles.secondaryBtn}>
                    <ThemedText style={styles.secondaryBtnText}>View program</ThemedText>
                  </Pressable>
                </Link>
                <Pressable
                  style={styles.secondaryBtn}
                  onPress={() => setShowSwitchWorkout(true)}
                  disabled={schedules.length === 0}
                >
                  <ThemedText style={styles.secondaryBtnText}>Switch today's workout</ThemedText>
                </Pressable>
                <Pressable
                  style={[styles.secondaryBtn, styles.secondaryBtnDestructive]}
                  onPress={() => setShowEndProgram(true)}
                >
                  <ThemedText style={styles.secondaryBtnDestructiveText}>End program</ThemedText>
                </Pressable>
              </View>
            </View>
          </View>
        )}
      </ThemedView>
      <Modal transparent visible={showSwitchWorkout} animationType="fade">
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <ThemedText type="defaultSemiBold">Switch today's workout</ThemedText>
            <ScrollView contentContainerStyle={styles.modalList}>
              {schedules.length === 0 ? (
                <ThemedText style={styles.emptyText}>No workouts found.</ThemedText>
              ) : (
                schedules.map((schedule) => {
                  const template = schedule.workout_template_id
                    ? templateById.get(schedule.workout_template_id) ?? null
                    : null;
                  const isSelected = schedule.id === nextScheduleId;
                  const scheduleTitleParts = [];
                  if (schedule.sort_order) {
                    scheduleTitleParts.push(`Workout ${schedule.sort_order}`);
                  }
                  if (schedule.week_number) {
                    scheduleTitleParts.push(`Week ${schedule.week_number}`);
                  }
                  if (schedule.day_number) {
                    scheduleTitleParts.push(`Day ${schedule.day_number}`);
                  }
                  return (
                    <Pressable
                      key={schedule.id}
                      accessibilityRole="button"
                      style={({ pressed }) => [
                        styles.modalRow,
                        isSelected && styles.modalRowSelected,
                        pressed && styles.btnPressed,
                      ]}
                      onPress={() => void switchWorkout(schedule)}
                    >
                      <ThemedText style={styles.modalRowTitle}>
                        {template?.name ?? 'Workout'}
                      </ThemedText>
                      <ThemedText style={styles.modalRowMeta}>
                        {scheduleTitleParts.join(' \u2022 ')}
                      </ThemedText>
                    </Pressable>
                  );
                })
              )}
            </ScrollView>
            <View style={styles.modalActions}>
              <Pressable
                accessibilityRole="button"
                style={styles.modalCloseBtn}
                onPress={() => setShowSwitchWorkout(false)}
              >
                <ThemedText style={styles.modalCloseText}>Close</ThemedText>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
      <Modal transparent visible={showEndProgram} animationType="fade">
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <ThemedText type="defaultSemiBold">End program?</ThemedText>
            <ThemedText style={styles.modalBody}>
              This will deactivate your current program. You can enroll again later.
            </ThemedText>
            <View style={styles.modalActionsRow}>
              <Pressable
                accessibilityRole="button"
                style={styles.modalSecondaryBtn}
                onPress={() => setShowEndProgram(false)}
              >
                <ThemedText style={styles.modalSecondaryText}>Cancel</ThemedText>
              </Pressable>
              <Pressable
                accessibilityRole="button"
                style={styles.modalDestructiveBtn}
                onPress={() => void endProgram()}
              >
                <ThemedText style={styles.modalDestructiveText}>End program</ThemedText>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
  },
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
  section: {
    gap: 12,
  },
  programCard: {
    padding: 18,
    borderRadius: 18,
    backgroundColor: '#f4f4f5',
    gap: 10,
  },
  cardHeaderRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
  },
  cardHeaderText: {
    flex: 1,
    gap: 6,
  },
  programTitle: {
    fontSize: 20,
    fontWeight: '700',
  },
  programMeta: {
    color: '#71717a',
  },
  aboutToggle: {
    color: '#2563eb',
    fontSize: 13,
    fontWeight: '600',
  },
  aboutToggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  aboutToggleIcon: {
    color: '#2563eb',
    fontSize: 12,
    fontWeight: '700',
  },
  programDescription: {
    color: '#52525b',
    fontSize: 13,
    lineHeight: 18,
  },
  progressWrap: {
    marginTop: 12,
    gap: 8,
  },
  progressTrack: {
    height: 8,
    borderRadius: 999,
    backgroundColor: '#e4e4e7',
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    borderRadius: 999,
    backgroundColor: '#2563eb',
  },
  progressLabel: {
    color: '#71717a',
  },
  cardDivider: {
    height: 1,
    backgroundColor: '#e4e4e7',
    marginVertical: 12,
  },
  upNextLabel: {
    fontSize: 15,
    fontWeight: '700',
    color: '#111827',
  },
  upNextTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: '#111827',
    marginTop: 4,
  },
  upNextMeta: {
    color: '#71717a',
    marginTop: 4,
  },
  primaryCta: {
    height: 52,
    borderRadius: 16,
    backgroundColor: '#2563eb',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 14,
  },
  primaryCtaDisabled: {
    opacity: 0.5,
  },
  primaryCtaText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '700',
  },
  secondaryActions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
    marginTop: 10,
  },
  secondaryBtn: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#e4e4e7',
    backgroundColor: '#fff',
  },
  secondaryBtnText: {
    color: '#2563eb',
    fontSize: 13,
    fontWeight: '600',
  },
  secondaryBtnDestructive: {
    borderColor: '#fecaca',
    backgroundColor: '#fef2f2',
  },
  secondaryBtnDestructiveText: {
    color: '#dc2626',
    fontSize: 13,
    fontWeight: '600',
  },
  programRow: {
    padding: 16,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#e4e4e7',
    backgroundColor: '#fff',
    gap: 10,
  },
  enrollBtn: {
    alignSelf: 'flex-start',
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 12,
    backgroundColor: '#2563eb',
  },
  enrollBtnText: {
    color: '#fff',
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(15,23,42,0.5)',
    justifyContent: 'center',
    padding: 24,
  },
  modalCard: {
    backgroundColor: '#fff',
    borderRadius: 16,
    padding: 16,
    maxHeight: '80%',
    gap: 12,
  },
  modalList: {
    gap: 10,
  },
  modalRow: {
    padding: 12,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#e4e4e7',
    backgroundColor: '#f8fafc',
    gap: 4,
  },
  modalRowSelected: {
    borderColor: '#2563eb',
    backgroundColor: '#eff6ff',
  },
  modalRowTitle: {
    fontSize: 14,
    fontWeight: '700',
  },
  modalRowMeta: {
    color: '#64748b',
    fontSize: 12,
  },
  modalActions: {
    alignItems: 'flex-end',
  },
  modalActionsRow: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 10,
  },
  modalCloseBtn: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 12,
    backgroundColor: '#2563eb',
  },
  modalCloseText: {
    color: '#fff',
    fontWeight: '600',
  },
  modalBody: {
    color: '#64748b',
    fontSize: 13,
    lineHeight: 18,
  },
  modalSecondaryBtn: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    backgroundColor: '#fff',
  },
  modalSecondaryText: {
    color: '#475569',
    fontWeight: '600',
  },
  modalDestructiveBtn: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 12,
    backgroundColor: '#dc2626',
  },
  modalDestructiveText: {
    color: '#fff',
    fontWeight: '600',
  },
  emptyText: {
    color: '#6b7280',
  },
  errorText: {
    color: '#dc2626',
  },
  btnPressed: {
    opacity: 0.85,
  },
});
