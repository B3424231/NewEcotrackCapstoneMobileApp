import React, { useState, useEffect } from 'react';
import { StyleSheet, View, ScrollView, Pressable, Platform, TextInput, RefreshControl, ActivityIndicator } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Image } from 'expo-image';
import { router } from 'expo-router';

import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useSettings } from '@/context/settings-context';
import { FloatingBottomNavbar } from '@/components/floating-navbar';
import { AppIcon } from '@/components/app-icon';
import {
  ICON_AIRCONSTATE,
  ICON_TEMPERATURE,
  ICON_SEARCH,
  ICON_MAINTENANCE,
  ICON_CHEVRON_RIGHT,
} from '@/constants/custom-icons';
import { fetchLiveAircons, LiveAirconUnit, subscribeToNodes } from '@/services/supabase';

export type AirconUnit = LiveAirconUnit;

export default function AirconsScreen() {
  const { effectiveTheme, colors } = useSettings();
  const isDark = effectiveTheme === 'dark';
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<'All' | 'Maintenance Due' | 'Normal'>('All');
  const [aircons, setAircons] = useState<LiveAirconUnit[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const loadAircons = async (showSpinner = false) => {
    if (showSpinner) setLoading(true);
    try {
      const data = await fetchLiveAircons();
      setAircons(data || []);
    } catch (e) {
      console.error('Error loading aircon units:', e);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    loadAircons(true);
    const unsubscribe = subscribeToNodes(() => {
      loadAircons(false);
    });
    return () => {
      unsubscribe();
    };
  }, []);

  const onRefresh = () => {
    setRefreshing(true);
    loadAircons(false);
  };

  const filteredUnits = aircons.filter((ac) => {
    if (filter !== 'All' && ac.status !== filter) return false;
    if (search.trim()) {
      const q = search.toLowerCase();
      return (
        ac.id.toLowerCase().includes(q) ||
        ac.name.toLowerCase().includes(q) ||
        ac.location.toLowerCase().includes(q) ||
        ac.type.toLowerCase().includes(q)
      );
    }
    return true;
  });

  const getStatusBadge = (status: AirconUnit['status']) => {
    switch (status) {
      case 'Normal':
        return { bg: '#d1fae5', text: '#059669', border: '#a7f3d0' };
      case 'Maintenance Due':
        return { bg: '#fef3c7', text: '#d97706', border: '#fde68a' };
      case 'Warning':
        return { bg: '#fee2e2', text: '#dc2626', border: '#fca5a5' };
    }
  };

  return (
    <LinearGradient
      colors={effectiveTheme === 'dark' ? ['#0f172a', '#0a0f1d'] : ['#d1fae5', '#ffffff']}
      style={[styles.container, { backgroundColor: colors.background }]}
      start={{ x: 0, y: 0 }}
      end={{ x: 0, y: 0.35 }}
    >
      <SafeAreaView style={styles.safeArea} edges={['top']}>
        <ScrollView
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator={false}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={onRefresh}
              tintColor="#059669"
              colors={['#059669']}
            />
          }
        >
          {/* Header */}
          <View style={styles.header}>
            <View style={styles.headerLeft}>
              <Image source={require('@/assets/images/ecoTrack.png')} style={styles.headerLogo} contentFit="contain" />
              <View>
                <ThemedText style={styles.headerTitle}>EcoTrack</ThemedText>
                <ThemedText style={styles.headerSubtitle}>Monitored Aircon Units</ThemedText>
              </View>
            </View>
            <View style={styles.unitCountBadge}>
              <ThemedText style={styles.unitCountText}>{aircons.length} Units</ThemedText>
            </View>
          </View>

          {/* Search */}
          <View style={styles.searchBarContainer}>
            <Image source={{ uri: ICON_SEARCH }} style={styles.searchIcon} contentFit="contain" />
            <TextInput
              style={styles.searchInput}
              placeholder="Search aircon ID, model, or room..."
              placeholderTextColor="#9ca3af"
              value={search}
              onChangeText={setSearch}
            />
          </View>

          {/* Filter chips */}
          <View style={styles.filterTabsRow}>
            {(['All', 'Maintenance Due', 'Normal'] as const).map((f) => {
              const isSelected = filter === f;
              return (
                <Pressable
                  key={f}
                  onPress={() => setFilter(f)}
                  style={[styles.filterChip, isSelected && styles.filterChipActive]}
                >
                  <ThemedText style={[styles.filterChipText, isSelected && styles.filterChipTextActive]}>
                    {f}
                  </ThemedText>
                </Pressable>
              );
            })}
          </View>

          {/* Aircon Units Grid */}
          <View style={styles.unitsList}>
            {loading && aircons.length === 0 ? (
              <View style={{ paddingVertical: 40, alignItems: 'center', justifyContent: 'center' }}>
                <ActivityIndicator size="large" color="#059669" />
                <ThemedText style={{ marginTop: 12, fontSize: 13, color: '#6b7280', fontWeight: '600' }}>
                  Loading AC units from database...
                </ThemedText>
              </View>
            ) : filteredUnits.length === 0 ? (
              <View style={{ paddingVertical: 40, alignItems: 'center', justifyContent: 'center' }}>
                <Image source={{ uri: ICON_AIRCONSTATE }} style={{ width: 36, height: 36, tintColor: '#9ca3af' }} contentFit="contain" />
                <ThemedText style={{ marginTop: 12, fontSize: 14, color: '#6b7280', fontWeight: '600' }}>
                  No monitored AC units found in database.
                </ThemedText>
              </View>
            ) : (
              filteredUnits.map((ac) => {
              const statusStyle = getStatusBadge(ac.status);
              return (
                <View key={ac.id} style={styles.unitCard}>
                  {/* Card Top */}
                  <View style={styles.cardTopRow}>
                    <View style={styles.acIdPill}>
                      <ThemedText style={styles.acIdText}>{ac.id}</ThemedText>
                    </View>
                    <View style={[styles.statusBadge, { backgroundColor: statusStyle.bg, borderColor: statusStyle.border }]}>
                      <ThemedText style={[styles.statusBadgeText, { color: statusStyle.text }]}>
                        {ac.status}
                      </ThemedText>
                    </View>
                  </View>

                  {/* Title & location */}
                  <ThemedText style={styles.unitNameText}>{ac.name}</ThemedText>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 4 }}>
                    <AppIcon name="location" size={12} color="#059669" />
                    <ThemedText style={styles.unitLocationText}>{ac.location}</ThemedText>
                  </View>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 2 }}>
                    <AppIcon name="gear" size={12} color={colors.textSecondary} />
                    <ThemedText style={styles.unitTypeText}>{ac.type}</ThemedText>
                  </View>

                  {/* Telemetry quick bar */}
                  <View style={styles.telemetryRow}>
                    <View style={styles.telemetryBox}>
                      <ThemedText style={styles.telemetryKey}>Room Temp</ThemedText>
                      <ThemedText style={styles.telemetryVal}>{ac.temp}</ThemedText>
                    </View>
                    <View style={styles.telemetryBox}>
                      <ThemedText style={styles.telemetryKey}>Target Set</ThemedText>
                      <ThemedText style={styles.telemetryVal}>{ac.setTemp}</ThemedText>
                    </View>
                    <View style={styles.telemetryBox}>
                      <ThemedText style={styles.telemetryKey}>Power</ThemedText>
                      <ThemedText style={[styles.telemetryVal, { color: ac.power === 'ON' ? '#059669' : '#64748b' }]}>
                        {ac.power}
                      </ThemedText>
                    </View>
                  </View>

                  {/* Action Link to Maintenance */}
                  <Pressable
                    onPress={() => {
                      if (ac.activeReportId) {
                        router.push({
                          pathname: '/Maintenance',
                          params: { reportId: ac.activeReportId },
                        } as any);
                      } else {
                        router.push('/Maintenance' as any);
                      }
                    }}
                    style={styles.openMaintenanceBtn}
                  >
                    <Image source={{ uri: ICON_MAINTENANCE }} style={styles.maintenanceIcon} contentFit="contain" />
                    <ThemedText style={styles.openMaintenanceBtnText} numberOfLines={1} ellipsizeMode="middle">
                      {ac.activeReportId ? `View Checklist (${ac.activeReportId})` : 'View Maintenance History'}
                    </ThemedText>
                    <Image source={{ uri: ICON_CHEVRON_RIGHT }} style={styles.chevronIcon} contentFit="contain" />
                  </Pressable>
                </View>
              );
            }))}
          </View>
        </ScrollView>

        <FloatingBottomNavbar currentPage="aircons" />
      </SafeAreaView>
    </LinearGradient>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  safeArea: {
    flex: 1,
  },
  scrollContent: {
    paddingBottom: 110,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing.four,
    paddingVertical: 14,
  },
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
  },
  headerLogo: {
    width: 36,
    height: 36,
    borderRadius: 8,
  },
  headerTitle: {
    fontSize: 16,
    fontWeight: '800',
    color: '#064e3b',
    lineHeight: 18,
    fontFamily: 'Roboto',
  },
  headerSubtitle: {
    fontSize: 12,
    color: '#059669',
    fontWeight: '700',
    fontFamily: 'Roboto',
  },
  unitCountBadge: {
    backgroundColor: '#ffffff',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: '#d1fae5',
  },
  unitCountText: {
    fontSize: 11.5,
    fontWeight: '800',
    color: '#059669',
    fontFamily: 'Roboto',
  },
  searchBarContainer: {
    marginHorizontal: Spacing.four,
    marginTop: 6,
    backgroundColor: '#ffffff',
    borderRadius: 14,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    height: 44,
    borderWidth: 1,
    borderColor: '#e2e8f0',
  },
  searchIcon: {
    width: 18,
    height: 18,
    tintColor: '#9ca3af',
    marginRight: 8,
  },
  searchInput: {
    flex: 1,
    fontSize: 13,
    color: '#1e293b',
    fontFamily: 'Roboto',
    padding: 0,
  },
  filterTabsRow: {
    flexDirection: 'row',
    paddingHorizontal: Spacing.four,
    marginTop: 12,
    gap: 8,
  },
  filterChip: {
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: 20,
    backgroundColor: '#ffffff',
    borderWidth: 1,
    borderColor: '#e2e8f0',
  },
  filterChipActive: {
    backgroundColor: '#0b291d',
    borderColor: '#0b291d',
  },
  filterChipText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#475569',
    fontFamily: 'Roboto',
  },
  filterChipTextActive: {
    color: '#ffffff',
  },
  unitsList: {
    paddingHorizontal: Spacing.four,
    marginTop: 16,
    gap: 14,
  },
  unitCard: {
    backgroundColor: '#ffffff',
    borderRadius: 20,
    padding: 16,
    borderWidth: 1.2,
    borderColor: '#e2e8f0',
    gap: 8,
    ...Platform.select({
      ios: {
        shadowColor: '#10b981',
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.08,
        shadowRadius: 8,
      },
      android: {
        elevation: 2,
      },
    }),
  },
  cardTopRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  acIdPill: {
    backgroundColor: '#f1f5f9',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
  },
  acIdText: {
    fontSize: 12,
    fontWeight: '900',
    color: '#0f172a',
    letterSpacing: 0.5,
    fontFamily: 'Roboto',
  },
  statusBadge: {
    paddingHorizontal: 9,
    paddingVertical: 3,
    borderRadius: 8,
    borderWidth: 1,
  },
  statusBadgeText: {
    fontSize: 11,
    fontWeight: '800',
    fontFamily: 'Roboto',
  },
  unitNameText: {
    fontSize: 15,
    fontWeight: '800',
    color: '#0b291d',
    fontFamily: 'Roboto',
  },
  unitLocationText: {
    fontSize: 12,
    color: '#475569',
    fontFamily: 'Roboto',
  },
  unitTypeText: {
    fontSize: 11.5,
    color: '#64748b',
    fontFamily: 'Roboto',
  },
  telemetryRow: {
    flexDirection: 'row',
    backgroundColor: '#f8fafc',
    borderRadius: 12,
    padding: 8,
    justifyContent: 'space-around',
    marginTop: 4,
  },
  telemetryBox: {
    alignItems: 'center',
  },
  telemetryKey: {
    fontSize: 10,
    fontWeight: '700',
    color: '#64748b',
    fontFamily: 'Roboto',
  },
  telemetryVal: {
    fontSize: 13,
    fontWeight: '900',
    color: '#1e293b',
    marginTop: 2,
    fontFamily: 'Roboto',
  },
  openMaintenanceBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#f0fdf4',
    borderWidth: 1,
    borderColor: '#a7f3d0',
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 12,
    marginTop: 4,
  },
  maintenanceIcon: {
    width: 16,
    height: 16,
    tintColor: '#059669',
  },
  openMaintenanceBtnText: {
    fontSize: 12,
    fontWeight: '800',
    color: '#065f46',
    flex: 1,
    marginLeft: 8,
    fontFamily: 'Roboto',
  },
  chevronIcon: {
    width: 14,
    height: 14,
    tintColor: '#059669',
  },
});
