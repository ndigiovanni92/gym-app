import { useState } from 'react';
import { Link } from 'expo-router';
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
} from 'react-native';
import * as Linking from 'expo-linking';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { supabase } from '@/src/lib/supabase';

export default function LoginScreen() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [isSignUp, setIsSignUp] = useState(false);
  const [infoMessage, setInfoMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const normalizeEmail = (value: string) => value.trim().toLowerCase();
  const isValidEmail = (value: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);

  const mapAuthError = (message: string) => {
    const lowered = message.toLowerCase();
    if (lowered.includes('invalid login credentials')) {
      return 'Email or password is incorrect.';
    }
    if (lowered.includes('email not confirmed')) {
      return 'Please verify your email, then sign in.';
    }
    if (lowered.includes('user already registered')) {
      return 'This email is already registered. Try signing in instead.';
    }
    if (lowered.includes('password should be at least')) {
      return 'Password must be at least 6 characters.';
    }
    if (lowered.includes('network')) {
      return 'Network error. Please try again.';
    }
    return message;
  };

  const handleAuth = async () => {
    setInfoMessage(null);
    setErrorMessage(null);

    const normalizedEmail = normalizeEmail(email);

    if (!normalizedEmail || !password) {
      setErrorMessage('Please enter your email and password.');
      return;
    }

    if (!isValidEmail(normalizedEmail)) {
      setErrorMessage('Please enter a valid email address.');
      return;
    }

    if (isSignUp && password.length < 6) {
      setErrorMessage('Password must be at least 6 characters.');
      return;
    }

    setLoading(true);

    const { error } = isSignUp
      ? await supabase.auth.signUp({
          email: normalizedEmail,
          password,
          options: {
            emailRedirectTo: Linking.createURL('/callback'),
          },
        })
      : await supabase.auth.signInWithPassword({ email: normalizedEmail, password });

    setLoading(false);

    if (error) {
      setErrorMessage(mapAuthError(error.message));
      return;
    }

    if (isSignUp) {
      setInfoMessage('Check your email for a verification link to finish creating your account.');
      return;
    }

    setInfoMessage(null);
  };

  return (
    <KeyboardAvoidingView
      style={styles.keyboardAvoider}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView
        contentContainerStyle={styles.scrollContent}
        keyboardShouldPersistTaps="handled"
      >
        <ThemedView style={styles.container}>
          <View style={styles.header}>
            <ThemedText type="title">{isSignUp ? 'Create account' : 'Welcome back'}</ThemedText>
            <ThemedText type="subtitle">
              {isSignUp ? 'Start your training journey' : 'Sign in to continue'}
            </ThemedText>
          </View>

          <View style={styles.form}>
            <View style={styles.modeSwitch}>
              <Pressable
                accessibilityRole="button"
                style={({ pressed }) => [
                  styles.modePill,
                  !isSignUp && styles.modePillActive,
                  pressed && styles.btnPressed,
                ]}
                onPress={() => {
                  setIsSignUp(false);
                  setInfoMessage(null);
                  setErrorMessage(null);
                }}
              >
                <ThemedText style={[styles.modePillText, !isSignUp && styles.modePillTextActive]}>
                  Sign in
                </ThemedText>
              </Pressable>
              <Pressable
                accessibilityRole="button"
                style={({ pressed }) => [
                  styles.modePill,
                  isSignUp && styles.modePillActive,
                  pressed && styles.btnPressed,
                ]}
                onPress={() => {
                  setIsSignUp(true);
                  setInfoMessage(null);
                  setErrorMessage(null);
                }}
              >
                <ThemedText style={[styles.modePillText, isSignUp && styles.modePillTextActive]}>
                  Create account
                </ThemedText>
              </Pressable>
            </View>

            <View style={styles.inputGroup}>
              <ThemedText style={styles.label}>Email</ThemedText>
              <TextInput
                autoCapitalize="none"
                autoComplete="email"
                keyboardType="email-address"
                onChangeText={setEmail}
                placeholder="you@example.com"
                style={styles.input}
                value={email}
              />
            </View>

            <View style={styles.inputGroup}>
              <ThemedText style={styles.label}>Password</ThemedText>
              <TextInput
                autoCapitalize="none"
                onChangeText={setPassword}
                placeholder="••••••••"
                secureTextEntry
                style={styles.input}
                value={password}
              />
              {isSignUp ? (
                <ThemedText style={styles.inputHint}>Minimum 6 characters.</ThemedText>
              ) : null}
            </View>

            {errorMessage ? <ThemedText style={styles.errorText}>{errorMessage}</ThemedText> : null}
            {infoMessage ? <ThemedText style={styles.infoText}>{infoMessage}</ThemedText> : null}

            <Pressable disabled={loading} onPress={handleAuth} style={styles.primaryButton}>
              <ThemedText type="defaultSemiBold" style={styles.primaryButtonText}>
                {loading ? 'Loading…' : isSignUp ? 'Create account' : 'Sign in'}
              </ThemedText>
            </Pressable>

            {!isSignUp ? (
              <Link href="/(auth)/forgot-password" asChild>
                <Pressable disabled={loading} style={({ pressed }) => [pressed && styles.btnPressed]}>
                  <ThemedText style={styles.forgotLink}>Forgot password?</ThemedText>
                </Pressable>
              </Link>
            ) : null}

            <Pressable
              disabled={loading}
              onPress={() => {
                setIsSignUp((prev) => !prev);
                setInfoMessage(null);
                setErrorMessage(null);
              }}
            >
              <ThemedText style={styles.secondaryAction}>
                {isSignUp ? 'Already have an account? Sign in' : 'Need an account? Sign up'}
              </ThemedText>
            </Pressable>
          </View>
        </ThemedView>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  keyboardAvoider: {
    flex: 1,
  },
  scrollContent: {
    flexGrow: 1,
  },
  container: {
    flex: 1,
    padding: 24,
    gap: 32,
    justifyContent: 'center',
  },
  header: {
    gap: 8,
  },
  form: {
    gap: 16,
  },
  modeSwitch: {
    flexDirection: 'row',
    backgroundColor: '#f8fafc',
    borderRadius: 12,
    padding: 4,
    gap: 6,
    borderWidth: 1,
    borderColor: '#e4e7ec',
  },
  modePill: {
    flex: 1,
    borderRadius: 10,
    paddingVertical: 8,
    alignItems: 'center',
  },
  modePillActive: {
    backgroundColor: '#eaf2ff',
  },
  modePillText: {
    color: '#475467',
    fontWeight: '600',
  },
  modePillTextActive: {
    color: '#1d4ed8',
  },
  inputGroup: {
    gap: 8,
  },
  label: {
    fontSize: 14,
  },
  input: {
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#d0d5dd',
    paddingHorizontal: 16,
    paddingVertical: 12,
    backgroundColor: '#fff',
  },
  primaryButton: {
    backgroundColor: '#111827',
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: 'center',
  },
  primaryButtonText: {
    color: '#fff',
  },
  secondaryAction: {
    textAlign: 'center',
    color: '#475467',
    fontSize: 13,
  },
  inputHint: {
    color: '#667085',
    fontSize: 12,
  },
  forgotLink: {
    textAlign: 'center',
    color: '#2563eb',
    fontSize: 13,
    fontWeight: '600',
  },
  errorText: {
    color: '#dc2626',
    fontSize: 13,
  },
  infoText: {
    color: '#2563eb',
    fontSize: 13,
  },
  btnPressed: {
    opacity: 0.85,
  },
});
