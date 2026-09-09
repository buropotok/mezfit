PRAGMA foreign_keys = ON;

-- Generated from the supplied Gym Keeper APK classes2.dex.
-- #34 owns copying the referenced media bytes into R2.
INSERT OR IGNORE INTO exercise_definition (
  scope, name, tracking_type, category_code, equipment_code, reference_source, reference_key, reference_order
) VALUES

  ('global', 'Elevated Standing Single Leg Calf Raise', 'weight_reps', 'legs', 'other', 'gym_keeper_apk', '47611305-Elevated-Standing-Single-Leg-Calf-Raise_Calves_180.gif', 302),
  ('global', 'Single Leg Glute Bridge (arms on chest) (female)', 'weight_reps', 'legs', 'other', 'gym_keeper_apk', '47911305-Single-Leg-Glute-Bridge-(arms-on-chest)-(female)_Hips_180.gif', 303),
  ('global', 'Dumbbell Lateral Lunge', 'weight_reps', 'legs', 'dumbbell_pair', 'gym_keeper_apk', '48531305-Dumbbell-Lateral-Lunge_Thighs_180.gif', 304),
  ('global', 'Elevated Standing Calf Raise', 'weight_reps', 'legs', 'other', 'gym_keeper_apk', '50091305-Elevated-Standing-Calf-Raise_Calves_180.gif', 305),
  ('global', 'Cable Shoulder Internal Rotation', 'weight_reps', 'shoulders', 'cable', 'gym_keeper_apk', '50881305-Cable-Shoulder-Internal-Rotation_Shoulders_180.gif', 306),
  ('global', 'Cable Standing Row', 'weight_reps', 'back', 'cable', 'gym_keeper_apk', '50901305-Cable-Standing-Row_Back_180.gif', 307),
  ('global', 'Captains Chair Leg Raise', 'weight_reps', 'legs', 'other', 'gym_keeper_apk', '51071305-Captains-Chair-Leg-Raise_Hips_180.gif', 308),
  ('global', 'Dumbbell Wood Chop Squat', 'weight_reps', 'core', 'dumbbell_pair', 'gym_keeper_apk', '51081305-Dumbbell-Wood-Chop-Squat_Waist_180.gif', 309),
  ('global', 'Cable Twist (VERSION 2) (male)', 'weight_reps', 'core', 'cable', 'gym_keeper_apk', '51181305-Cable-Twist-(VERSION-2)-(male)_Waist_180.gif', 310),
  ('global', 'Dumbbell Deadlift (VERSION 2) (male)', 'weight_reps', 'legs', 'dumbbell_pair', 'gym_keeper_apk', '51191305-Dumbbell-Deadlift-(VERSION-2)-(male)_Hips_180.gif', 311),
  ('global', 'Cable Kickback (male)', 'weight_reps', 'legs', 'cable', 'gym_keeper_apk', '51201305-Cable-Kickback-(male)_Hips_180.gif', 312),
  ('global', 'Dumbbell Sumo Squat (male)', 'weight_reps', 'legs', 'dumbbell_pair', 'gym_keeper_apk', '51211305-Dumbbell-Sumo-Squat-(male)_Thighs_180.gif', 313),
  ('global', 'Barbell Clean and Jerk', 'weight_reps', 'other', 'barbell', 'gym_keeper_apk', '51221305-Barbell-Clean-and-Jerk_Weightlifting_180.gif', 314),
  ('global', 'Cable Reverse Grip Pulldown', 'weight_reps', 'back', 'cable', 'gym_keeper_apk', '51231305-Cable-Reverse-Grip-Pulldown_Back_180.gif', 315),
  ('global', 'Lateral Step Up', 'weight_reps', 'legs', 'other', 'gym_keeper_apk', '51541305-Lateral-Step-Up_Thighs_180.gif', 316),
  ('global', 'Plank on Hands', 'weight_reps', 'core', 'bodyweight', 'gym_keeper_apk', '51591305-Plank-on-Hands_Waist_180.gif', 317),
  ('global', 'Curtsey Squat (female)', 'weight_reps', 'legs', 'other', 'gym_keeper_apk', '51771305-Curtsey-Squat-(female)_Thighs_180.gif', 318),
  ('global', 'Cable Lying Triceps Extension (Low)', 'weight_reps', 'arms', 'cable', 'gym_keeper_apk', '52431305-Cable-Lying-Triceps-Extension-(Low)_Upper-Arms_180.gif', 319),
  ('global', 'V Up Hold (male)', 'weight_reps', 'core', 'other', 'gym_keeper_apk', '53441305-V-Up-Hold-(male)_Waist_180.gif', 320),
  ('global', 'Close Grip Pull Up', 'weight_reps', 'back', 'bodyweight', 'gym_keeper_apk', '54791305-Close-Grip-Pull-Up_Back_180.gif', 321),
  ('global', 'Smith Rear Lunge (version 2) (male)', 'weight_reps', 'legs', 'machine', 'gym_keeper_apk', '58251305-Smith-Rear-Lunge-(version-2)-(male)_Thighs_180.gif', 322),
  ('global', 'Cable Straight Arm Pulldown (VERSION 2)', 'weight_reps', 'back', 'cable', 'gym_keeper_apk', '60361305-Cable-Straight-Arm-Pulldown-(VERSION-2)_Back_180.gif', 323),
  ('global', 'Cable Standing Wrist Reverse Curl', 'weight_reps', 'arms', 'cable', 'gym_keeper_apk', '63631305-Cable-Standing-Wrist-Reverse-Curl_Forearms_180.gif', 324),
  ('global', 'Bodyweight Bench Squat (female)', 'weight_reps', 'legs', 'bodyweight', 'gym_keeper_apk', '65411305-Bodyweight-Bench-Squat-(female)_Thighs_180.gif', 325),
  ('global', 'Smith Sumo Deadlift', 'weight_reps', 'legs', 'machine', 'gym_keeper_apk', '73741305-Smith-Sumo-Deadlift_Hips_180.gif', 326),
  ('global', 'Cable Front Squat with V bar', 'weight_reps', 'legs', 'cable', 'gym_keeper_apk', '75781305-Cable-Front-Squat-with-V-bar_Thighs_180.gif', 327),
  ('global', 'Weighted Front Raise Hold', 'weight_reps', 'shoulders', 'other', 'gym_keeper_apk', '75881305-Weighted-Front-Raise-Hold_Shoulders_180.gif', 328),
  ('global', 'Wide Chin Up (male)', 'weight_reps', 'back', 'other', 'gym_keeper_apk', '81891305-Wide-Chin-Up-(male)_Back_180.gif', 329),
  ('global', 'Barbell Curtsey Lunge (female)', 'weight_reps', 'legs', 'barbell', 'gym_keeper_apk', '81901305-Barbell-Curtsey-Lunge-(female)_Thighs_180.gif', 330),
  ('global', 'Cable Standing Hip Flexion (male)', 'weight_reps', 'legs', 'cable', 'gym_keeper_apk', '81911305-Cable-Standing-Hip-Flexion-(male)_Hips_180.gif', 331),
  ('global', 'Dumbbell Sumo Deadlift (male)', 'weight_reps', 'legs', 'dumbbell_pair', 'gym_keeper_apk', '81921305-Dumbbell-Sumo-Deadlift-(male)_Hips_180.gif', 332),
  ('global', 'Cable Reverse Woodchop (male)', 'weight_reps', 'core', 'cable', 'gym_keeper_apk', '81931305-Cable-Reverse-Woodchop-(male)_Waist_180.gif', 333),
  ('global', 'Lying Knee Raise (male)', 'weight_reps', 'core', 'other', 'gym_keeper_apk', '81941305-Lying-Knee-Raise-(male)_Waist_180.gif', 334);
