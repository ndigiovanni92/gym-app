import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';
import * as Linking from 'expo-linking';
import type { EmailOtpType } from '@supabase/supabase-js';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { supabase } from '@/src/lib/supabase';

type CallbackStatus = 'loading' | 'success' | 'error';

type CallbackParams = {
  accessToken?: string | null;
  refreshToken?: string | null;
  tokenHash?: string | null;
  otpType?: EmailOtpType | null;
  code?: string | null;
  errorDescription?: string | null;
};

const readFirst = (value: string | string[] | undefined) =>
  Array.isArray(value) ? value[0] : value ?? null;

const parseParamsFromUrl = (url: string | null): CallbackParams => {
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

  const otpType = pick('type');

  return {
    accessToken: pick('access_token'),
    refreshToken: pick('refresh_token'),
    tokenHash: pick('token_hash'),
    otpType: otpType ? (otpType as EmailOtpType) : null,
    code: pick('code'),
    errorDescription: pick('error_description'),
  };
};

export default function AuthCallbackScreen() {
  const router = useRouter();
  const localParams = useLocalSearchParams<Record<string, string | string[]>>();
  const incomingUrl = Linking.useURL();
  const [status, setStatus] = useState<CallbackStatus>('loading');
  const [message, setMessage] = useState('Finishing account verification...');
  const processedRef = useRef(false);

  const params = useMemo(() => {
    const fromUrl = parseParamsFromUrl(incomingUrl);
    return {
      accessToken: fromUrl.accessToken ?? readFirst(localParams.access_token),
      refreshToken: fromUrl.refreshToken ?? readFirst(localParams.refresh_token),
      tokenHash: fromUrl.tokenHash ?? readFirst(localParams.token_hash),
      otpType:
        fromUrl.otpType ??
        ((readFirst(localParams.type) as EmailOtpType | null | undefined) ?? null),
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

    const completeAuth = async () => {
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

        setStatus('success');
        setMessage('Success. Your account has been verified.');
        return;
      }

      if (params.tokenHash && params.otpType) {
        const { error } = await supabase.auth.verifyOtp({
          token_hash: params.tokenHash,
          type: params.otpType,
        });

        if (error) {
          setStatus('error');
          setMessage(error.message);
          return;
        }

        setStatus('success');
        setMessage('Success. Your account has been verified.');
        return;
      }

      if (params.code) {
        const { error } = await supabase.auth.exchangeCodeForSession(params.code);
        if (error) {
          setStatus('error');
          setMessage(error.message);
          return;
        }

        setStatus('success');
        setMessage('Success. Your account has been verified.');
        return;
      }

      setStatus('error');
      setMessage('This verification link is invalid or expired.');
    };

    processedRef.current = true;
    void completeAuth();
  }, [incomingUrl, localParams, params]);

  return (
    <ThemedView style={styles.container}>
      <View style={styles.card}>
        {status === 'loading' ? <ActivityIndicator size="large" /> : null}
        <ThemedText type="title" style={styles.title}>
          {status === 'loading'
            ? 'Verifying...'
            : status === 'success'
            ? 'Email verified'
            : 'Verification failed'}
        </ThemedText>
        <ThemedText style={styles.body}>{message}</ThemedText>
        <Pressable
          accessibilityRole="button"
          style={styles.button}
          onPress={() => router.replace(status === 'success' ? '/(tabs)' : '/(auth)/login')}
        >
          <ThemedText style={styles.buttonText}>
            {status === 'success' ? 'Continue' : 'Back to login'}
          </ThemedText>
        </Pressable>
      </View>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  card: {
    width: '100%',
    borderRadius: 16,
    padding: 20,
    backgroundColor: '#ffffff',
    borderWidth: 1,
    borderColor: '#e4e7ec',
    gap: 12,
  },
  title: {
    fontSize: 24,
  },
  body: {
    color: '#475467',
    lineHeight: 20,
  },
  button: {
    marginTop: 6,
    backgroundColor: '#111827',
    borderRadius: 12,
    paddingVertical: 12,
    alignItems: 'center',
  },
  buttonText: {
    color: '#ffffff',
  },
});
