import { Link, useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Modal, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect } from '@react-navigation/native';

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
  next_workout_template_id?: string | null;
};

type ActiveSession = {
  id: string;
  workout_template_id?: string | null;
  program_schedule_id?: string | null;
  started_at?: string | null;
};

type LastCompleted = {
  completed_at?: string | null;
  workout_template_id?: string | null;
  workout_templates?: {
    name?: string | null;
  } | null;
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
  const router = useRouter();
  const [activeProgram, setActiveProgram] = useState<ActiveProgram | null>(null);
  const [schedules, setSchedules] = useState<ProgramSchedule[]>([]);
  const [nextScheduleId, setNextScheduleId] = useState<string | null>(null);
  const [templates, setTemplates] = useState<WorkoutTemplate[]>([]);
  const [activeSession, setActiveSession] = useState<ActiveSession | null>(null);
  const [lastCompleted, setLastCompleted] = useState<LastCompleted | null>(null);
  const [programs, setPrograms] = useState<Program[]>([]);
  const [enrollingProgramId, setEnrollingProgramId] = useState<string | null>(null);
  const [userId, setUserId] = useState<string | null>(null);
  const [showProgramAbout, setShowProgramAbout] = useState(false);
  const [showWorkoutDetails, setShowWorkoutDetails] = useState(false);
  const [showSwitchWorkout, setShowSwitchWorkout] = useState(false);
  const [showEndProgram, setShowEndProgram] = useState(false);
  const [showWorkoutActions, setShowWorkoutActions] = useState(false);
  const [showProgramActions, setShowProgramActions] = useState(false);
  const [endingWorkout, setEndingWorkout] = useState(false);
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
  const hasActiveWorkout = !!activeSession?.id;
  const activeTemplate = activeSession?.workout_template_id
    ? templateById.get(activeSession.workout_template_id) ?? null
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
  const elapsedMinutes = activeSession?.started_at
    ? Math.max(
        1,
        Math.round((Date.now() - new Date(activeSession.started_at).getTime()) / 60000),
      )
    : null;
  const displayTemplate = hasActiveWorkout ? activeTemplate ?? nextTemplate : nextTemplate;
  const upNextTitle = displayTemplate
    ? `${displayTemplate.name ?? 'Workout'}${
        hasActiveWorkout && elapsedMinutes
          ? ` \u2022 ${elapsedMinutes} min elapsed`
          : displayTemplate.target_duration_min
          ? ` \u2022 ~${displayTemplate.target_duration_min} min`
          : ''
      }`
    : nextSchedule?.workout_template_id
    ? 'Workout scheduled'
    : 'No workout scheduled';
  const primaryCtaTemplateId = hasActiveWorkout
    ? activeSession?.workout_template_id ?? nextSchedule?.workout_template_id ?? null
    : nextSchedule?.workout_template_id ?? null;
  const primaryCtaLabel = hasActiveWorkout ? 'Resume Workout' : 'Start Workout';
  const lastCompletedDate = lastCompleted?.completed_at
    ? new Date(lastCompleted.completed_at).toLocaleDateString('en-US', {
        weekday: 'short',
        month: 'short',
        day: 'numeric',
      })
    : null;
  const lastCompletedDays =
    lastCompleted?.completed_at && Number.isFinite(Date.parse(lastCompleted.completed_at))
      ? Math.max(
          0,
          Math.floor(
            (Date.now() - new Date(lastCompleted.completed_at).getTime()) / (1000 * 60 * 60 * 24),
          ),
        )
      : null;
  const lastCompletedTitle =
    lastCompleted?.workout_templates?.name ?? lastCompleted?.workout_template_id ?? null;
  const ctaHint =
    !hasActiveWorkout && nextSchedule?.workout_template_id && !nextTemplate
      ? "Workout template details aren't available yet."
      : !hasActiveWorkout && !nextSchedule?.workout_template_id
      ? 'No next workout found for this program.'
      : null;

  const refreshToday = useCallback(async () => {
    setLoading(true);
    setErrorMessage(null);
    const todayKey = new Date().toISOString().slice(0, 10);

    const { data: userData } = await supabase.auth.getUser();
    const nextUserId = userData?.user?.id ?? null;
    setUserId(nextUserId);

    if (!nextUserId) {
      setActiveProgram(null);
      setSchedules([]);
      setNextScheduleId(null);
      setTemplates([]);
      setLastCompleted(null);
      setPrograms([]);
      setShowWorkoutDetails(false);
      setLoading(false);
      return;
    }

    const { data: programData, error: programError } = await supabase
      .from('user_programs')
      .select('id, program_id, programs ( id, title, description )')
      .eq('active', true)
      .eq('user_id', nextUserId)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (programError) {
      setErrorMessage(programError.message);
      setActiveProgram(null);
      setSchedules([]);
      setNextScheduleId(null);
      setTemplates([]);
      setLastCompleted(null);
      setPrograms([]);
      setShowWorkoutDetails(false);
      setLoading(false);
      return;
    }

    if (!programData) {
      setActiveProgram(null);
      setSchedules([]);
      setNextScheduleId(null);
      setTemplates([]);
      setLastCompleted(null);

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
      setShowWorkoutDetails(false);
      return;
    }

    setActiveProgram(programData as ActiveProgram);
    setShowProgramAbout(false);
    setShowSwitchWorkout(false);
    setShowWorkoutDetails(false);

    const { data: progressData } = await supabase
      .from('user_program_progress')
      .select('next_program_schedule_id, next_workout_template_id')
      .eq('user_program_id', programData.id)
      .maybeSingle();

    const progress = (progressData as ProgramProgress | null) ?? null;
    let nextSchedulePointer = progress?.next_program_schedule_id ?? null;

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
    const scheduleRows = (scheduleList as ProgramSchedule[] | null) ?? [];

    if (!nextSchedulePointer && scheduleRows.length > 0) {
      const fallbackSchedule =
        scheduleRows.find((schedule) => schedule.week_number === 1 && schedule.day_number === 1) ??
        scheduleRows[0];
      if (fallbackSchedule) {
        const { error: progressUpdateError } = await supabase
          .from('user_program_progress')
          .upsert(
            {
              user_program_id: programData.id,
              next_program_schedule_id: fallbackSchedule.id,
              next_workout_template_id: fallbackSchedule.workout_template_id ?? null,
              updated_at: new Date().toISOString(),
            },
            { onConflict: 'user_program_id' },
          );

        if (!progressUpdateError) {
          nextSchedulePointer = fallbackSchedule.id;
        }
      }
    }

    setNextScheduleId(nextSchedulePointer);

    const { data: sessionData } = await supabase
      .from('workout_sessions')
      .select('id, workout_template_id, program_schedule_id, started_at')
      .eq('user_program_id', programData.id)
      .is('completed_at', null)
      .eq('session_date', todayKey)
      .order('started_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    setActiveSession((sessionData as ActiveSession | null) ?? null);

    const { data: lastCompletedData } = await supabase
      .from('workout_sessions')
      .select('completed_at, workout_template_id, workout_templates ( name )')
      .eq('user_program_id', programData.id)
      .not('completed_at', 'is', null)
      .order('completed_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    setLastCompleted((lastCompletedData as LastCompleted | null) ?? null);

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
    void refreshToday();
  }, [refreshToday]);

  useFocusEffect(
    useCallback(() => {
      void refreshToday();
    }, [refreshToday]),
  );

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
        await refreshToday();
        return;
      }

      enrollmentId = (enrollmentData as { id?: string } | null)?.id ?? null;
    }

    if (updateError) {
      setErrorMessage('Error enrolling in program.');
      setEnrollingProgramId(null);
      await refreshToday();
      return;
    }

    const { data: firstSchedule } = await supabase
      .from('program_schedule')
      .select('id, week_number, day_number, workout_template_id')
      .eq('program_id', program.id)
      .eq('week_number', 1)
      .eq('day_number', 1)
      .maybeSingle();

    let selectedSchedule = (firstSchedule as ProgramSchedule | null) ?? null;
    if (!selectedSchedule?.id) {
      const { data: fallbackSchedule } = await supabase
        .from('program_schedule')
        .select('id, week_number, day_number, workout_template_id')
        .eq('program_id', program.id)
        .order('week_number', { ascending: true })
        .order('day_number', { ascending: true })
        .limit(1)
        .maybeSingle();
      selectedSchedule = (fallbackSchedule as ProgramSchedule | null) ?? null;
    }
    const nextScheduleId = selectedSchedule?.id ?? null;
    const nextWeek = selectedSchedule?.week_number ?? 1;
    const nextTemplateId = selectedSchedule?.workout_template_id ?? null;

    if (enrollmentId && nextScheduleId) {
      await supabase
        .from('user_program_progress')
        .upsert(
          {
            user_program_id: enrollmentId,
            next_program_schedule_id: nextScheduleId,
            next_workout_template_id: nextTemplateId,
            current_week: nextWeek,
            updated_at: new Date().toISOString(),
          },
          { onConflict: 'user_program_id' },
        );
    }

    setEnrollingProgramId(null);
    await refreshToday();
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
        next_workout_template_id: schedule.workout_template_id ?? null,
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
        next_workout_template_id: schedule.workout_template_id ?? null,
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
    await refreshToday();
  };

  const endWorkout = async () => {
    if (!activeProgram?.id) {
      setErrorMessage('No active workout to end.');
      return;
    }
    setEndingWorkout(true);
    const { data, error } = await supabase
      .from('workout_sessions')
      .update({ completed_at: new Date().toISOString(), status: 'completed' })
      .eq('user_program_id', activeProgram.id)
      .eq('status', 'in_progress')
      .is('completed_at', null)
      .select('id, status, completed_at');
    if (error) {
      setErrorMessage('Unable to end workout.');
      console.warn('Failed to end workout', { error, userProgramId: activeProgram.id });
      setEndingWorkout(false);
      return;
    }
    if (!data || data.length === 0) {
      setErrorMessage('Unable to end workout.');
      console.warn('No workout session updated', { userProgramId: activeProgram.id });
      setEndingWorkout(false);
      return;
    }
    setActiveSession(null);
    setEndingWorkout(false);
    await refreshToday();
  };

  return (
    <SafeAreaView style={styles.safeArea}>
      <ThemedView style={styles.container}>
        <View style={styles.header}>
          <ThemedText type="title">Today</ThemedText>
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
              <View style={styles.momentumRow}>
                {lastCompletedDays !== null ? (
                  <ThemedText style={styles.momentumText}>
                    Last workout: {lastCompletedDays === 0 ? 'today' : `${lastCompletedDays} days ago`}
                  </ThemedText>
                ) : null}
              </View>
              <View style={styles.workoutHeaderRow}>
                <ThemedText style={styles.upNextTitle}>{upNextTitle}</ThemedText>
                <Pressable
                  accessibilityRole="button"
                  style={({ pressed }) => [
                    styles.workoutMenuBtn,
                    pressed && styles.btnPressed,
                  ]}
                  onPress={() => setShowWorkoutActions(true)}
                >
                  <ThemedText style={styles.workoutMenuText}>⋯</ThemedText>
                </Pressable>
              </View>
              {nextTemplate?.notes ? (
                <Pressable
                  accessibilityRole="button"
                  style={({ pressed }) => [
                    styles.aboutToggleRow,
                    pressed && styles.btnPressed,
                  ]}
                  onPress={() => setShowWorkoutDetails((prev) => !prev)}
                >
                  <ThemedText style={styles.aboutToggle}>
                    {showWorkoutDetails ? 'Hide details' : 'Workout details'}
                  </ThemedText>
                  <ThemedText style={styles.aboutToggleIcon}>
                    {showWorkoutDetails ? '▴' : '▾'}
                  </ThemedText>
                </Pressable>
              ) : null}
              {showWorkoutDetails && nextTemplate?.notes ? (
                <ThemedText style={styles.programDescription}>{nextTemplate.notes}</ThemedText>
              ) : null}
              {primaryCtaTemplateId ? (
                <Link
                  href={{
                    pathname: '/workout/[templateId]',
                    params: {
                      templateId: primaryCtaTemplateId,
                      ...(hasActiveWorkout ? { resume: '1' } : {}),
                    },
                  }}
                  asChild>
                  <Pressable style={styles.primaryCta}>
                    <View style={styles.primaryCtaGlow} />
                    <ThemedText style={styles.primaryCtaText}>{primaryCtaLabel}</ThemedText>
                  </Pressable>
                </Link>
              ) : (
                <>
                  <Pressable style={[styles.primaryCta, styles.primaryCtaDisabled]} disabled>
                    <ThemedText style={styles.primaryCtaText}>Start workout</ThemedText>
                  </Pressable>
                  {ctaHint ? <ThemedText style={styles.ctaHint}>{ctaHint}</ThemedText> : null}
                </>
              )}
              <View style={styles.secondaryActions} />
              <View style={styles.cardDivider} />
              <ThemedText style={styles.sectionLabel}>Active program</ThemedText>
              <View style={styles.cardHeaderRow}>
                <View style={styles.cardHeaderText}>
                  <ThemedText style={styles.programTitle}>
                    {activeProgram.programs?.title ?? 'Your Program'}
                  </ThemedText>
                  {totalWorkouts > 0 ? (
                    <View style={styles.progressWrap}>
                      <View style={styles.progressTrack}>
                        <View
                          style={[styles.progressFill, { width: `${programProgress * 100}%` }]}
                        />
                      </View>
                      {progressSummary ? (
                        <ThemedText style={styles.progressLabel}>{progressSummary}</ThemedText>
                      ) : null}
                    </View>
                  ) : null}
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
                        {showProgramAbout ? 'Hide details' : 'Program details'}
                      </ThemedText>
                      <ThemedText style={styles.aboutToggleIcon}>
                        {showProgramAbout ? '▴' : '▾'}
                      </ThemedText>
                    </Pressable>
                  ) : null}
                </View>
                <Pressable
                  accessibilityRole="button"
                  style={({ pressed }) => [
                    styles.workoutMenuBtn,
                    pressed && styles.btnPressed,
                  ]}
                  onPress={() => setShowProgramActions(true)}
                >
                  <ThemedText style={styles.workoutMenuText}>⋯</ThemedText>
                </Pressable>
              </View>
              {showProgramAbout ? (
                <>
                  {programDescription ? (
                    <ThemedText style={styles.programDescription}>
                      {programDescription}
                    </ThemedText>
                  ) : null}
                  {lastCompletedTitle && lastCompletedDate ? (
                    <View style={styles.lastCompletedRow}>
                      <ThemedText style={styles.lastCompletedLabel}>
                        Last completed workout
                      </ThemedText>
                      <ThemedText style={styles.lastCompletedValue}>
                        {lastCompletedTitle} {'\u2022'} {lastCompletedDate}
                      </ThemedText>
                    </View>
                  ) : null}
                </>
              ) : null}
            </View>
          </View>
        )}
      </ThemedView>
      <Modal transparent visible={showSwitchWorkout} animationType="fade">
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <ThemedText type="defaultSemiBold">Switch today&apos;s workout</ThemedText>
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
      <Modal transparent visible={showWorkoutActions} animationType="fade">
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <ThemedText type="defaultSemiBold">Workout actions</ThemedText>
            <View style={styles.modalList}>
              <Pressable
                accessibilityRole="button"
                style={({ pressed }) => [styles.modalRow, pressed && styles.btnPressed]}
                onPress={() => {
                  setShowWorkoutActions(false);
                  setShowSwitchWorkout(true);
                }}
                disabled={schedules.length === 0}
              >
                <ThemedText style={styles.modalRowTitle}>Switch workout</ThemedText>
              </Pressable>
              {hasActiveWorkout ? (
                <Pressable
                  accessibilityRole="button"
                  style={({ pressed }) => [
                    styles.modalRow,
                    styles.modalRowDestructive,
                    pressed && styles.btnPressed,
                  ]}
                  onPress={() => {
                    setShowWorkoutActions(false);
                    void endWorkout();
                  }}
                  disabled={endingWorkout || !activeSession?.id}
                >
                  <ThemedText style={styles.modalRowDestructiveText}>
                    {endingWorkout ? 'Ending workout...' : 'End workout'}
                  </ThemedText>
                </Pressable>
              ) : null}
              {activeProgram?.program_id ? (
                <Pressable
                  accessibilityRole="button"
                  style={({ pressed }) => [styles.modalRow, pressed && styles.btnPressed]}
                  onPress={() => {
                    setShowWorkoutActions(false);
                    router.push({
                      pathname: '/program/[programId]',
                      params: { programId: activeProgram.program_id },
                    });
                  }}
                >
                  <ThemedText style={styles.modalRowTitle}>View program</ThemedText>
                </Pressable>
              ) : null}
            </View>
            <View style={styles.modalActions}>
              <Pressable
                accessibilityRole="button"
                style={styles.modalCloseBtn}
                onPress={() => setShowWorkoutActions(false)}
              >
                <ThemedText style={styles.modalCloseText}>Close</ThemedText>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
      <Modal transparent visible={showProgramActions} animationType="fade">
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <ThemedText type="defaultSemiBold">Program actions</ThemedText>
            <View style={styles.modalList}>
              {activeProgram?.program_id ? (
                <Pressable
                  accessibilityRole="button"
                  style={({ pressed }) => [styles.modalRow, pressed && styles.btnPressed]}
                  onPress={() => {
                    setShowProgramActions(false);
                    router.push({
                      pathname: '/program/[programId]',
                      params: { programId: activeProgram.program_id },
                    });
                  }}
                >
                  <ThemedText style={styles.modalRowTitle}>View program</ThemedText>
                </Pressable>
              ) : null}
              <Pressable
                accessibilityRole="button"
                style={({ pressed }) => [
                  styles.modalRow,
                  styles.modalRowDestructive,
                  pressed && styles.btnPressed,
                ]}
                onPress={() => {
                  setShowProgramActions(false);
                  setShowEndProgram(true);
                }}
              >
                <ThemedText style={styles.modalRowDestructiveText}>End program</ThemedText>
              </Pressable>
            </View>
            <View style={styles.modalActions}>
              <Pressable
                accessibilityRole="button"
                style={styles.modalCloseBtn}
                onPress={() => setShowProgramActions(false)}
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
    gap: 28,
  },
  header: {
    gap: 8,
  },
  content: {
    gap: 28,
  },
  section: {
    gap: 12,
  },
  programCard: {
    padding: 22,
    borderRadius: 18,
    backgroundColor: '#f8fafc',
    gap: 14,
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
    fontWeight: '800',
    color: '#0f172a',
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
    backgroundColor: '#eef2f7',
    marginVertical: 12,
  },
  upNextLabel: {
    fontSize: 15,
    fontWeight: '700',
    color: '#111827',
  },
  sectionLabel: {
    fontSize: 12,
    fontWeight: '700',
    color: '#6b7280',
    textTransform: 'uppercase',
    letterSpacing: 0.6,
    marginTop: 6,
  },
  upNextTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: '#111827',
    marginTop: 4,
    flex: 1,
    marginRight: 8,
  },
  workoutHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    justifyContent: 'space-between',
  },
  workoutMenuBtn: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 10,
    backgroundColor: '#eef2f7',
  },
  workoutMenuText: {
    fontSize: 18,
    fontWeight: '800',
    color: '#111827',
  },
  momentumRow: {
    gap: 4,
    marginTop: 2,
  },
  momentumText: {
    color: '#6b7280',
    fontSize: 12,
    fontWeight: '600',
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
    shadowColor: '#1e3a8a',
    shadowOpacity: 0.2,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 6 },
    elevation: 4,
  },
  primaryCtaGlow: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: '45%',
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    backgroundColor: 'rgba(255,255,255,0.18)',
  },
  primaryCtaDisabled: {
    opacity: 0.5,
  },
  primaryCtaText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '700',
  },
  ctaHint: {
    color: '#94a3b8',
    fontSize: 12,
    marginTop: 6,
  },
  secondaryActions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
    marginTop: 10,
    marginBottom: 6,
  },
  lastCompletedRow: {
    marginTop: 12,
    paddingTop: 12,
    borderTopWidth: 1,
    borderColor: '#e4e4e7',
    gap: 4,
  },
  lastCompletedLabel: {
    color: '#71717a',
    fontSize: 12,
    fontWeight: '600',
  },
  lastCompletedValue: {
    color: '#111827',
    fontSize: 13,
    fontWeight: '700',
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
    borderColor: '#e2e8f0',
    backgroundColor: '#ffffff',
  },
  secondaryBtnDestructiveText: {
    color: '#475569',
    fontSize: 13,
    fontWeight: '600',
  },
  secondaryBtnDisabled: {
    opacity: 0.6,
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
  modalRowDestructive: {
    borderColor: '#fecaca',
    backgroundColor: '#fef2f2',
  },
  modalRowDestructiveText: {
    color: '#dc2626',
    fontSize: 14,
    fontWeight: '700',
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
