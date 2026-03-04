import { useState } from 'react';
import { Link } from 'expo-router';
import { KeyboardAvoidingView, Platform, Pressable, StyleSheet, TextInput, View } from 'react-native';
import * as Linking from 'expo-linking';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { supabase } from '@/src/lib/supabase';

export default function ForgotPasswordScreen() {
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [infoMessage, setInfoMessage] = useState<string | null>(null);

  const normalizeEmail = (value: string) => value.trim().toLowerCase();
  const isValidEmail = (value: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);

  const sendResetEmail = async () => {
    setErrorMessage(null);
    setInfoMessage(null);

    const normalizedEmail = normalizeEmail(email);
    if (!normalizedEmail) {
      setErrorMessage('Please enter your email.');
      return;
    }
    if (!isValidEmail(normalizedEmail)) {
      setErrorMessage('Please enter a valid email address.');
      return;
    }

    setLoading(true);
    const { error } = await supabase.auth.resetPasswordForEmail(normalizedEmail, {
      redirectTo: Linking.createURL('/reset-password'),
    });
    setLoading(false);

    if (error) {
      setErrorMessage(error.message);
      return;
    }

    setInfoMessage('Check your email for a password reset link.');
  };

  return (
    <KeyboardAvoidingView
      style={styles.keyboardAvoider}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ThemedView style={styles.container}>
        <View style={styles.header}>
          <ThemedText type="title">Reset password</ThemedText>
          <ThemedText type="subtitle">We&apos;ll email you a secure reset link.</ThemedText>
        </View>

        <View style={styles.form}>
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

          {errorMessage ? <ThemedText style={styles.errorText}>{errorMessage}</ThemedText> : null}
          {infoMessage ? <ThemedText style={styles.infoText}>{infoMessage}</ThemedText> : null}

          <Pressable
            disabled={loading}
            onPress={sendResetEmail}
            style={[styles.primaryButton, loading && styles.primaryButtonDisabled]}
          >
            <ThemedText type="defaultSemiBold" style={styles.primaryButtonText}>
              {loading ? 'Sending...' : 'Send reset link'}
            </ThemedText>
          </Pressable>

          <Link href="/(auth)/login" asChild>
            <Pressable style={({ pressed }) => [pressed && styles.btnPressed]}>
              <ThemedText style={styles.secondaryAction}>Back to sign in</ThemedText>
            </Pressable>
          </Link>
        </View>
      </ThemedView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  keyboardAvoider: {
    flex: 1,
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
  primaryButtonDisabled: {
    opacity: 0.6,
  },
  primaryButtonText: {
    color: '#fff',
  },
  secondaryAction: {
    textAlign: 'center',
    color: '#475467',
    fontSize: 13,
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
