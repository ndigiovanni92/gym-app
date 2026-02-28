Copy/paste prompt: “Workout Program Builder (Supabase-ready)”

Context: You are building a workout program that must be inserted into Supabase following our existing schema:

workout_templates (one per workout/day)

workout_template_exercises (many per template; links to exercises)

exercises table already exists (use exercise_id whenever possible; match by name if needed)

Goal: Generate (1) the training plan (weeks + schedule) and (2) Supabase-ready rows for insertion.

1) My Training Inputs (fill these in)

Profile
Age (optional):
Sex (optional):
Height/weight (optional):
Training experience (beginner / intermediate / advanced):
Current strength numbers (optional): squat / bench / deadlift / OHP (or “unknown”)

Primary goal (pick up to 2)
Muscle gain / Strength / Fat loss / General fitness / Athletic performance / Rehab-prehab
Days per week + schedule
Days per week (e.g., 3/4/5/6):
Preferred days (e.g., Mon/Tue/Thu/Fri):
Max session length (minutes):
Conditioning included? (none / 1–2x / 3+x per week)
Equipment available
Gym access? (yes/no)
Available equipment (check all): barbell, dumbbells, kettlebells, cables, machines, pull-up bar, bands, cardio equipment

Limitations (e.g., “no barbells”, “no machines”, “hotel gym”):

Constraints / injuries

Any injuries or movements to avoid:

Sensitive areas (shoulders/knees/lower back/etc.):

Exercises you must include (if any):

Exercises you hate / refuse to do (if any):

Style preferences

Workout style: bodybuilding / powerbuilding / strength-focused / minimalistic / athletic

Volume tolerance: low / moderate / high

Supersets? (yes/no)

Include core work? (yes/no)

Include mobility/warm-up blocks? (yes/no)

Progression

Program length (weeks) (e.g., 8 / 12 / 16):

Progression preference (pick one):

A) Double progression (reps up then add weight)

B) RPE-based (target effort)

C) % of 1RM (if numbers provided)

Deload week included? (yes/no; if yes, when?)

Rest times (important for schema)

Default rest for compounds (seconds):

Default rest for accessories (seconds):

Default rest for isolation (seconds):

Optional: rest overrides for specific lifts:

2) Supabase Exercise Library Mapping (choose one option)

Option A (best): I will paste an export of my exercises table with at least:

id, name (or title)
(Paste here)

Option B: If you don’t have the full list, use best-guess matches by exercise name and return a “missing exercises” list I need to add to exercises.

3) Output Requirements (tell the assistant what to return)

When you generate the program, return:

A) Human-readable plan

Weekly schedule (e.g., Day 1 Upper / Day 2 Lower…)

Each day: exercises in order with sets/reps and any notes

Progression rules (how to add reps/weight each week)

Deload approach (if included)

B) Supabase-ready structured output
Return two payloads:

1) workout_templates rows

For each workout/day, create an object like:

{
  "name": "Upper A",
  "description": "Optional notes for the workout day",
  "day_index": 1,
  "program_weeks": 12
}


(If your schema doesn’t have these exact columns, keep name and description and I’ll adapt.)

2) workout_template_exercises rows

For each exercise in a template, create an object like:

{
  "workout_template_id": "<TEMP_ID_OR_TEMPLATE_NAME_REFERENCE>",
  "exercise_id": "<EXERCISE_UUID>",
  "order_index": 1,
  "sets": 4,
  "reps": null,
  "reps_min": 6,
  "reps_max": 10,
  "rep_range": "6-10",
  "rest_seconds": 120,
  "notes": "RPE 7-8; last set optional AMRAP",
  "superset_group": null
}


Rules:

Prefer exercise_id from my exercises table.

Always set order_index.

Always set one of:

reps (fixed reps) OR

reps_min + reps_max (range) and set rep_range string

Always set rest_seconds (use defaults unless overridden).

If supersets are enabled, set superset_group like "A", "B" etc.

If any exercise can’t be mapped to an existing exercise_id, put it in a missing_exercises list with the exact name to add.

4) Generate the program now

Using everything above, build a program that fits my constraints and preferences, and return sections A + B.