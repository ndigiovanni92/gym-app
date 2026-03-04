import { useEffect, useMemo, useRef, useState } from 'react';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { KeyboardAvoidingView, Platform, Pressable, StyleSheet, TextInput, View } from 'react-native';
import * as Linking from 'expo-linking';
import type { EmailOtpType } from '@supabase/supabase-js';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { supabase } from '@/src/lib/supabase';

type Status = 'verifying' | 'ready' | 'done' | 'error';

const readFirst = (value: string | string[] | undefined) =>
  Array.isArray(value) ? value[0] : value ?? null;

const parseParamsFromUrl = (url: string | null) => {
  if (!url) {
    return {};
  }
  const parsed = Linking.parse(url);
  const query = parsed.queryParams ?? {};
  const hash = url.includes('#') ? new URLSearchParams(url.split('#')[1]) : null;

  const pick = (key: string) => {
    const fromQuery = query[key];
    if (typeof fromQuery === 'string') {
      return fromQuery;
    }
    if (Array.isArray(fromQuery)) {
      return fromQuery[0] ?? null;
    }
    return hash?.get(key) ?? null;
  };

  return {
    accessToken: pick('access_token'),
    refreshToken: pick('refresh_token'),
    tokenHash: pick('token_hash'),
    otpType: pick('type'),
    code: pick('code'),
    errorDescription: pick('error_description'),
  };
};

export default function ResetPasswordScreen() {
  const router = useRouter();
  const localParams = useLocalSearchParams<Record<string, string | string[]>>();
  const incomingUrl = Linking.useURL();
  const [status, setStatus] = useState<Status>('verifying');
  const [message, setMessage] = useState('Verifying reset link...');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [saving, setSaving] = useState(false);
  const processedRef = useRef(false);

  const params = useMemo(() => {
    const fromUrl = parseParamsFromUrl(incomingUrl);
    return {
      accessToken: fromUrl.accessToken ?? readFirst(localParams.access_token),
      refreshToken: fromUrl.refreshToken ?? readFirst(localParams.refresh_token),
      tokenHash: fromUrl.tokenHash ?? readFirst(localParams.token_hash),
      otpType: fromUrl.otpType ?? readFirst(localParams.type),
      code: fromUrl.code ?? readFirst(localParams.code),
      errorDescription: fromUrl.errorDescription ?? readFirst(localParams.error_description),
    };
  }, [incomingUrl, localParams]);

  useEffect(() => {
    if (processedRef.current) {
      return;
    }

    const hasAuthParams =
      !!params.errorDescription ||
      !!params.accessToken ||
      !!params.refreshToken ||
      !!params.tokenHash ||
      !!params.otpType ||
      !!params.code;
    const hasRouteContext = !!incomingUrl || Object.keys(localParams).length > 0;
    if (!hasAuthParams && !hasRouteContext) {
      return;
    }

    const verifyRecoverySession = async () => {
      if (params.errorDescription) {
        setStatus('error');
        setMessage(decodeURIComponent(params.errorDescription));
        return;
      }

      if (params.accessToken && params.refreshToken) {
        const { error } = await supabase.auth.setSession({
          access_token: params.accessToken,
          refresh_token: params.refreshToken,
        });
        if (error) {
          setStatus('error');
          setMessage(error.message);
          return;
        }
        setStatus('ready');
        setMessage('Set a new password for your account.');
        return;
      }

      if (params.tokenHash && params.otpType) {
        const { error } = await supabase.auth.verifyOtp({
          token_hash: params.tokenHash,
          type: params.otpType as EmailOtpType,
        });
        if (error) {
          setStatus('error');
          setMessage(error.message);
          return;
        }
        setStatus('ready');
        setMessage('Set a new password for your account.');
        return;
      }

      if (params.code) {
        const { error } = await supabase.auth.exchangeCodeForSession(params.code);
        if (error) {
          setStatus('error');
          setMessage(error.message);
          return;
        }
        setStatus('ready');
        setMessage('Set a new password for your account.');
        return;
      }

      setStatus('error');
      setMessage('This reset link is invalid or expired.');
    };

    processedRef.current = true;
    void verifyRecoverySession();
  }, [incomingUrl, localParams, params]);

  const handleUpdatePassword = async () => {
    if (password.length < 6) {
      setMessage('Password must be at least 6 characters.');
      setStatus('error');
      return;
    }
    if (password !== confirmPassword) {
      setMessage('Passwords do not match.');
      setStatus('error');
      return;
    }

    setSaving(true);
    const { error } = await supabase.auth.updateUser({ password });
    setSaving(false);

    if (error) {
      setStatus('error');
      setMessage(error.message);
      return;
    }

    await supabase.auth.signOut();
    setStatus('done');
    setMessage('Password updated. Please sign in with your new password.');
  };

  return (
    <KeyboardAvoidingView
      style={styles.keyboardAvoider}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ThemedView style={styles.container}>
        <View style={styles.header}>
          <ThemedText type="title">Reset password</ThemedText>
          <ThemedText type="subtitle">{message}</ThemedText>
        </View>

        {status === 'ready' ? (
          <View style={styles.form}>
            <View style={styles.inputGroup}>
              <ThemedText style={styles.label}>New password</ThemedText>
              <TextInput
                autoCapitalize="none"
                onChangeText={setPassword}
                placeholder="••••••••"
                secureTextEntry
                style={styles.input}
                value={password}
              />
            </View>
            <View style={styles.inputGroup}>
              <ThemedText style={styles.label}>Confirm password</ThemedText>
              <TextInput
                autoCapitalize="none"
                onChangeText={setConfirmPassword}
                placeholder="••••••••"
                secureTextEntry
                style={styles.input}
                value={confirmPassword}
              />
            </View>
            <ThemedText style={styles.inputHint}>Minimum 6 characters.</ThemedText>
            <Pressable
              disabled={saving}
              onPress={handleUpdatePassword}
              style={[styles.primaryButton, saving && styles.primaryButtonDisabled]}
            >
              <ThemedText style={styles.primaryButtonText}>
                {saving ? 'Saving...' : 'Update password'}
              </ThemedText>
            </Pressable>
          </View>
        ) : (
          <Pressable
            accessibilityRole="button"
            style={styles.primaryButton}
            onPress={() => router.replace('/(auth)/login')}
          >
            <ThemedText style={styles.primaryButtonText}>
              {status === 'done' ? 'Back to sign in' : 'Go to login'}
            </ThemedText>
          </Pressable>
        )}
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
    justifyContent: 'center',
    gap: 24,
  },
  header: {
    gap: 8,
  },
  form: {
    gap: 14,
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
  inputHint: {
    color: '#667085',
    fontSize: 12,
  },
  primaryButton: {
    backgroundColor: '#111827',
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: 'center',
    marginTop: 8,
  },
  primaryButtonDisabled: {
    opacity: 0.65,
  },
  primaryButtonText: {
    color: '#fff',
    fontWeight: '600',
  },
});
