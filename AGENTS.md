# Gym MVP (Expo Router + Supabase) - Agent Instructions

## Goal
Build an iOS-first MVP gym app with Expo Router + Supabase:
Auth -> Today -> Workout Mode (log sets + rest timer) -> Exercise tutorial modal -> substitutions.

## Constraints
- Do not change Supabase schema (tables + RLS already set up).
- Do not hardcode credentials in code.
- Keep MVP small: no social, no nutrition, no coach marketplace yet.

## Current Setup
- Expo Router (tabs template).
- Supabase client in src/lib/supabase.ts using EXPO_PUBLIC_SUPABASE_URL and EXPO_PUBLIC_SUPABASE_ANON_KEY.
- Supabase RLS blocks anon; authenticated reads work.
- Data exists in public.exercises and program structure tables.

## Required Screens
1) /(auth)/login - email/password sign-in (optional sign-up)
2) /(tabs)/index -> Today screen
3) /workout/[templateId] -> Workout Mode
4) /modal(s) for exercise tutorial and substitutions

## Required Queries
- Active program: user_programs(active=true) join programs
- Templates: workout_templates where program_id = active program
- Prescription: workout_template_exercises for templateId filtered by program week (week_start <= week <= week_end) joining exercises
- Start session: insert workout_sessions
- Log set: insert set_logs
- Substitutions: exercise_substitutions by primary_exercise_id

## UX Notes
- Workout Mode should be distraction-minimal: big log button, auto rest timer, next set preview.
