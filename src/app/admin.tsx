import { useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Linking,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  useWindowDimensions,
  View,
} from 'react-native';

import { useAuth } from '../../components/AuthProvider';
import { getFriendlyAuthError } from '../../services/authService';
import { createPrivateDocumentUrl, listRiderDocuments, type RiderDocument } from '../../services/documentService';
import {
  getAdminComplaints,
  getAdminPayments,
  getAdminProfiles,
  getAdminRiders,
  getAdminRides,
  getAdminStats,
  getAdminUsers,
  updateRiderApproval,
  type AdminRiderRow,
  type AdminStats,
} from '../../services/adminService';
import { updateComplaintStatus } from '../../services/complaintService';
import { getAdminRiderEarnings, setRideEarningPayoutStatus } from '../../services/earningsService';
import { DEFAULT_FARE_CONFIG, getFareConfig, saveFareConfig, type FareConfig } from '../../services/fareService';
import type { Complaint, Payment, PayoutStatus, Profile, Ride, RiderEarning } from '../../types/database';

type AdminSection = 'overview' | 'users' | 'riders' | 'approvals' | 'rides' | 'payments' | 'earnings' | 'fare' | 'complaints';

const navigation: { key: AdminSection; label: string; icon: string }[] = [
  { key: 'overview', label: 'Dashboard', icon: '⌂' },
  { key: 'users', label: 'Users', icon: '◉' },
  { key: 'riders', label: 'Riders', icon: '▱' },
  { key: 'approvals', label: 'Pending Approvals', icon: '◷' },
  { key: 'rides', label: 'Rides', icon: '↗' },
  { key: 'payments', label: 'Payments', icon: '₹' },
  { key: 'earnings', label: 'Rider Earnings', icon: '↗' },
  { key: 'fare', label: 'Fare Settings', icon: '⚙' },
  { key: 'complaints', label: 'Support', icon: '✉' },
];

function formatDate(value: string | null | undefined) {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? '—'
    : date.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}

function formatMoney(value: number | null | undefined) {
  return `₹${Number(value ?? 0).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;
}

function display(value: string | number | null | undefined) {
  return value === null || value === undefined || value === '' ? '—' : String(value);
}

export default function AdminScreen() {
  const router = useRouter();
  const { width } = useWindowDimensions();
  const isWide = width >= 980;
  const { account, isLoading, logout } = useAuth();
  const [section, setSection] = useState<AdminSection>('overview');
  const [stats, setStats] = useState<AdminStats | null>(null);
  const [riders, setRiders] = useState<AdminRiderRow[]>([]);
  const [users, setUsers] = useState<Profile[]>([]);
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [rides, setRides] = useState<Ride[]>([]);
  const [payments, setPayments] = useState<Payment[]>([]);
  const [earnings, setEarnings] = useState<RiderEarning[]>([]);
  const [fareConfig, setFareConfig] = useState<FareConfig>(DEFAULT_FARE_CONFIG);
  const [fareFields, setFareFields] = useState({
    baseFare: String(DEFAULT_FARE_CONFIG.baseFare),
    perKmRate: String(DEFAULT_FARE_CONFIG.perKmRate),
    minimumFare: String(DEFAULT_FARE_CONFIG.minimumFare),
    platformFee: String(DEFAULT_FARE_CONFIG.platformFee),
    tax: String(DEFAULT_FARE_CONFIG.tax),
  });
  const [complaints, setComplaints] = useState<Complaint[]>([]);
  const [riderDocuments, setRiderDocuments] = useState<Record<string, RiderDocument[]>>({});
  const [selectedUserId, setSelectedUserId] = useState<string | null>(null);
  const [selectedRiderId, setSelectedRiderId] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [busyRiderId, setBusyRiderId] = useState<string | null>(null);
  const [busyEarningRideId, setBusyEarningRideId] = useState<string | null>(null);
  const [isSavingFare, setIsSavingFare] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const loadDashboard = useCallback(async () => {
    setErrorMessage(null);
    try {
      const [nextStats, nextRiders, nextUsers, nextRides, nextPayments, nextComplaints, nextProfiles, nextEarnings, nextFareConfig] = await Promise.all([
        getAdminStats(),
        getAdminRiders(),
        getAdminUsers(),
        getAdminRides(),
        getAdminPayments(),
        getAdminComplaints(),
        getAdminProfiles(),
        getAdminRiderEarnings(),
        getFareConfig(),
      ]);
      setStats(nextStats);
      setRiders(nextRiders);
      setUsers(nextUsers);
      setRides(nextRides);
      setPayments(nextPayments as Payment[]);
      setEarnings(nextEarnings);
      setFareConfig(nextFareConfig);
      setFareFields({
        baseFare: String(nextFareConfig.baseFare),
        perKmRate: String(nextFareConfig.perKmRate),
        minimumFare: String(nextFareConfig.minimumFare),
        platformFee: String(nextFareConfig.platformFee),
        tax: String(nextFareConfig.tax),
      });
      setComplaints(nextComplaints);
      setProfiles(nextProfiles);
    } catch (loadError) {
      setErrorMessage(getFriendlyAuthError(loadError));
    } finally {
      setIsRefreshing(false);
    }
  }, []);

  const refresh = useCallback(async () => {
    setIsRefreshing(true);
    await loadDashboard();
  }, [loadDashboard]);

  useEffect(() => {
    if (!isLoading && account?.profile.role !== 'admin') {
      if (account?.profile.role === 'rider') {
        router.replace('/rider-home');
      } else if (account?.profile.role === 'user') {
        router.replace('/user-home');
      } else {
        router.replace('/admin/login');
      }
    }
  }, [account, isLoading, router]);

  useEffect(() => {
    if (account?.profile.role === 'admin') {
      const refreshTimer = setTimeout(refresh, 0);
      return () => clearTimeout(refreshTimer);
    }
  }, [account, refresh]);

  const profileById = useMemo(() => new Map(profiles.map((profile) => [profile.id, profile])), [profiles]);
  const selectedUser = users.find((user) => user.id === selectedUserId) ?? null;
  const pendingRiders = riders.filter(({ rider }) => rider.approval_status === 'pending' || rider.approval_status === null);
  const visibleUsers = users.filter((user) => {
    const query = search.trim().toLowerCase();
    return !query || [user.full_name, user.email, user.phone].some((value) => value?.toLowerCase().includes(query));
  });
  const visibleRiders = riders.filter(({ profile, rider }) => {
    const query = search.trim().toLowerCase();
    return !query || [profile?.full_name, profile?.email, profile?.phone, rider.vehicle_number].some((value) => value?.toLowerCase().includes(query));
  });
  const panelStyle = [styles.panel, !isWide && styles.panelMobile];
  const pageContentStyle = [styles.pageContent, !isWide && styles.pageContentMobile];
  const topBarStyle = [styles.topBar, !isWide && styles.topBarMobile];

  const handleApproval = async (userId: string, approvalStatus: 'approved' | 'rejected') => {
    setBusyRiderId(userId);
    setNotice(null);
    setErrorMessage(null);
    try {
      await updateRiderApproval(userId, approvalStatus);
      await refresh();
      setNotice(`Rider ${approvalStatus === 'approved' ? 'approved' : 'rejected'} successfully.`);
    } catch (approvalError) {
      setErrorMessage(getFriendlyAuthError(approvalError));
    } finally {
      setBusyRiderId(null);
    }
  };

  const handleSelectRider = async (userId: string) => {
    setSelectedRiderId(userId);
    setErrorMessage(null);
    try {
      const documents = await listRiderDocuments(userId);
      setRiderDocuments((current) => ({ ...current, [userId]: documents }));
    } catch (documentError) {
      setErrorMessage(getFriendlyAuthError(documentError));
    }
  };

  const handleOpenDocument = async (path: string) => {
    try {
      const signedUrl = await createPrivateDocumentUrl(path);
      await Linking.openURL(signedUrl);
    } catch (documentError) {
      setErrorMessage(getFriendlyAuthError(documentError));
    }
  };

  const handleComplaint = async (complaintId: string) => {
    try {
      await updateComplaintStatus(complaintId, 'in_review');
      await refresh();
      setNotice('Support request moved to review.');
    } catch (complaintError) {
      setErrorMessage(getFriendlyAuthError(complaintError));
    }
  };

  const handleFareSave = async () => {
    const nextConfig: FareConfig = {
      baseFare: Number(fareFields.baseFare),
      perKmRate: Number(fareFields.perKmRate),
      minimumFare: Number(fareFields.minimumFare),
      platformFee: Number(fareFields.platformFee),
      tax: Number(fareFields.tax),
    };
    setIsSavingFare(true);
    setErrorMessage(null);
    setNotice(null);
    try {
      const savedConfig = await saveFareConfig(nextConfig);
      setFareConfig(savedConfig);
      setFareFields({
        baseFare: String(savedConfig.baseFare),
        perKmRate: String(savedConfig.perKmRate),
        minimumFare: String(savedConfig.minimumFare),
        platformFee: String(savedConfig.platformFee),
        tax: String(savedConfig.tax),
      });
      setNotice('Fare settings saved. New bookings will use these rates.');
    } catch (saveError) {
      setErrorMessage(getFriendlyAuthError(saveError));
    } finally {
      setIsSavingFare(false);
    }
  };

  const handlePayoutStatus = async (rideId: string, status: PayoutStatus) => {
    setBusyEarningRideId(rideId);
    setErrorMessage(null);
    setNotice(null);
    try {
      const updated = await setRideEarningPayoutStatus(rideId, status);
      setEarnings((current) => current.map((row) => row.ride_id === rideId ? updated : row));
      setNotice(`Payout marked ${status}.`);
    } catch (updateError) {
      setErrorMessage(getFriendlyAuthError(updateError));
    } finally {
      setBusyEarningRideId(null);
    }
  };

  const handleLogout = async () => {
    await logout();
    router.replace('/admin/login');
  };

  if (isLoading || !account || account.profile.role !== 'admin') {
    return (
      <SafeAreaView style={styles.loadingScreen}>
        <ActivityIndicator size="large" color="#198754" />
        <Text style={styles.loadingText}>Verifying administrator access…</Text>
      </SafeAreaView>
    );
  }

  const pageTitle = navigation.find((item) => item.key === section)?.label ?? 'Dashboard';
  const renderRiderCard = ({ rider, profile }: AdminRiderRow) => {
    const riderDetails = rider as typeof rider & RiderWithLegacyLicence;
    const isSelected = selectedRiderId === rider.user_id;
    const riderDocs = riderDocuments[rider.user_id] ?? [];
    const approvalStatus = rider.approval_status ?? 'pending';
    return (
      <View key={rider.user_id} style={styles.recordCard}>
        <TouchableOpacity style={styles.recordMain} onPress={() => void handleSelectRider(rider.user_id)} activeOpacity={0.8}>
          <View style={[styles.avatar, styles.riderAvatar]}><Text style={styles.avatarText}>{(profile?.full_name?.[0] ?? 'R').toUpperCase()}</Text></View>
          <View style={styles.recordCopy}>
            <Text style={styles.recordName}>{profile?.full_name ?? 'Rider profile'}</Text>
            <Text style={styles.recordMeta}>{display(profile?.phone)} · {rider.vehicle_type.toUpperCase()} · {display(rider.vehicle_number)}</Text>
            <Text style={styles.recordSubMeta}>Licence {display(rider.licence_number ?? riderDetails.driving_license_number)} · {rider.is_online ? 'Online' : 'Offline'}</Text>
          </View>
          <StatusPill label={approvalStatus} tone={approvalStatus === 'approved' ? 'green' : approvalStatus === 'rejected' || approvalStatus === 'blocked' ? 'red' : 'amber'} />
        </TouchableOpacity>
        {approvalStatus === 'pending' ? (
          <View style={styles.actionRow}>
            <TouchableOpacity style={styles.approveButton} onPress={() => void handleApproval(rider.user_id, 'approved')} disabled={busyRiderId === rider.user_id}>
              <Text style={styles.approveButtonText}>{busyRiderId === rider.user_id ? 'Saving…' : 'Approve rider'}</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.rejectButton} onPress={() => void handleApproval(rider.user_id, 'rejected')} disabled={busyRiderId === rider.user_id}>
              <Text style={styles.rejectButtonText}>Reject</Text>
            </TouchableOpacity>
          </View>
        ) : null}
        {isSelected ? (
          <View style={styles.detailsPanel}>
            <Text style={styles.detailsHeading}>Rider information</Text>
            <DetailLine label="Email" value={display(profile?.email)} />
            <DetailLine label="Phone" value={display(profile?.phone)} />
            <DetailLine label="Vehicle" value={`${rider.vehicle_type.toUpperCase()} · ${display(rider.vehicle_number)}`} />
            <DetailLine label="Licence number" value={display(rider.licence_number ?? riderDetails.driving_license_number)} />
            <DetailLine label="ID proof type" value={display(rider.id_proof_type)} />
            <DetailLine label="Approval status" value={approvalStatus} />
            <DetailLine label="Registered" value={formatDate(rider.created_at)} />
            <Text style={styles.documentTitle}>Submitted documents</Text>
            {riderDocs.length === 0 ? <Text style={styles.muted}>No uploaded documents found.</Text> : riderDocs.map((document) => (
              <TouchableOpacity key={document.path} onPress={() => void handleOpenDocument(document.path)} style={styles.documentLink}>
                <Text style={styles.documentLinkText}>Open {document.name}</Text>
              </TouchableOpacity>
            ))}
            {riderDetails.id_proof_path || riderDetails.vehicle_photo_path ? (
              <Text style={styles.muted}>Document references are also stored in the rider profile.</Text>
            ) : null}
          </View>
        ) : null}
      </View>
    );
  };

  return (
    <SafeAreaView style={styles.safeArea}>
      <View style={[styles.appFrame, !isWide && styles.appFrameMobile]}>
        {isWide ? (
          <View style={styles.sidebar}>
            <View style={styles.sidebarBrand}>
              <View style={styles.sidebarLogo}><Text style={styles.sidebarLogoText}>A</Text></View>
              <View><Text style={styles.sidebarTitle}>AutoWala</Text><Text style={styles.sidebarCaption}>ADMIN CONSOLE</Text></View>
            </View>
            <Text style={styles.navSectionLabel}>WORKSPACE</Text>
            <View style={styles.sideNav}>
              {navigation.map((item) => <NavItem key={item.key} item={item} selected={section === item.key} onPress={() => { setSection(item.key); setSearch(''); }} />)}
            </View>
            <View style={styles.sidebarFooter}>
              <View style={styles.accountDot}><Text style={styles.accountDotText}>{(account.profile.full_name[0] ?? 'A').toUpperCase()}</Text></View>
              <View style={styles.sidebarAccount}><Text style={styles.sidebarAccountName} numberOfLines={1}>{account.profile.full_name}</Text><Text style={styles.sidebarAccountRole}>Administrator</Text></View>
              <TouchableOpacity onPress={() => void handleLogout()} style={styles.sidebarLogout}><Text style={styles.sidebarLogoutText}>↪</Text></TouchableOpacity>
            </View>
          </View>
        ) : null}

        <View style={styles.main}>
          {!isWide ? (
            <View style={styles.mobileNavWrap}>
              <View style={styles.mobileBrandRow}>
                <View style={styles.sidebarLogo}><Text style={styles.sidebarLogoText}>A</Text></View>
                <View style={styles.mobileBrandCopy}><Text style={styles.sidebarTitle}>AutoWala</Text><Text style={styles.sidebarCaption}>ADMIN CONSOLE</Text></View>
                <TouchableOpacity onPress={() => void handleLogout()} style={styles.mobileLogout}><Text style={styles.mobileLogoutText}>Log out</Text></TouchableOpacity>
              </View>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.mobileNav}>
                {navigation.map((item) => <NavItem key={item.key} item={item} selected={section === item.key} onPress={() => { setSection(item.key); setSearch(''); }} compact />)}
              </ScrollView>
            </View>
          ) : null}

          <View style={topBarStyle}>
            <View>
              <Text style={styles.breadcrumb}>ADMINISTRATION / {pageTitle.toUpperCase()}</Text>
              <Text style={styles.pageTitle}>{pageTitle}</Text>
            </View>
            <View style={styles.topActions}>
              {isWide ? <Text style={styles.topAccount}>{account.profile.email ?? account.user.email ?? 'Signed in'}</Text> : null}
              <TouchableOpacity style={styles.refreshButton} onPress={() => void refresh()} disabled={isRefreshing}>
                <Text style={styles.refreshButtonText}>{isRefreshing ? 'Refreshing…' : '↻  Refresh'}</Text>
              </TouchableOpacity>
            </View>
          </View>

          <ScrollView style={styles.pageScroll} contentContainerStyle={pageContentStyle}>
            {errorMessage ? <Text accessibilityRole="alert" style={styles.alertError}>{errorMessage}</Text> : null}
            {notice ? <Text accessibilityLiveRegion="polite" style={styles.alertSuccess}>{notice}</Text> : null}
            {isRefreshing && !stats ? <ActivityIndicator style={styles.firstLoad} size="large" color="#198754" /> : null}

            {section === 'overview' ? (
              <>
                <View style={styles.welcomeBlock}>
                  <View><Text style={styles.welcomeTitle}>Good to see you, {account.profile.full_name.split(' ')[0]}.</Text><Text style={styles.welcomeSub}>Here&apos;s how AutoWala is doing today.</Text></View>
                  <View style={styles.dateBadge}><Text style={styles.dateBadgeText}>{new Date().toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'short' })}</Text></View>
                </View>
                <View style={styles.statsGrid}>
                  <StatCard label="Total users" value={stats?.users} caption="Registered passengers" accent="#3978D1" />
                  <StatCard label="Total riders" value={stats?.riders} caption={`${stats?.approvedRiders ?? 0} approved`} accent="#168B62" />
                  <StatCard label="Online riders" value={stats?.onlineRiders} caption="Approved and available" accent="#168B62" />
                  <StatCard label="Awaiting review" value={stats?.pendingRiders} caption="Rider applications" accent="#D39A24" />
                  <StatCard label="Total rides" value={stats?.rides} caption={`${stats?.activeRides ?? 0} currently active`} accent="#8459C9" />
                  <StatCard label="Completed rides" value={stats?.completedRides} caption="Successfully completed" accent="#168B62" />
                  <StatCard label="Cancelled rides" value={stats?.cancelledRides} caption="All time" accent="#D96459" />
                  <StatCard label="Payments received" value={formatMoney(stats?.totalPaid)} caption={`${stats?.paidPayments ?? 0} paid transactions`} accent="#167D87" />
                  <StatCard label="Pending payments" value={formatMoney(stats?.pendingPaymentAmount)} caption={`${stats?.payments ?? 0} total transactions`} accent="#D39A24" />
                </View>
                <View style={styles.dashboardColumns}>
                  <View style={panelStyle}>
                    <PanelHeading title="Pending rider approvals" subtitle="Applications that need a decision" actionLabel="View all" onAction={() => setSection('approvals')} />
                    {pendingRiders.length === 0 ? <Text style={styles.emptyText}>All caught up. No pending applications.</Text> : pendingRiders.slice(0, 5).map(renderRiderCard)}
                  </View>
                  <View style={panelStyle}>
                    <PanelHeading title="Recent rides" subtitle="Latest activity across your network" actionLabel="View rides" onAction={() => setSection('rides')} />
                    {rides.slice(0, 5).map((ride) => <RideRow key={ride.id} ride={ride} passenger={profileById.get(ride.passenger_id)} rider={ride.rider_id ? profileById.get(ride.rider_id) : undefined} />)}
                    {rides.length === 0 ? <Text style={styles.emptyText}>No rides have been booked yet.</Text> : null}
                  </View>
                </View>
              </>
            ) : null}

            {section === 'users' ? (
              <View style={panelStyle}>
                <PanelHeading title="User management" subtitle={`${users.length} registered user accounts`} />
                <SearchBox value={search} onChangeText={setSearch} placeholder="Search by name, email or phone" />
                {visibleUsers.map((user) => (
                  <TouchableOpacity key={user.id} style={styles.recordCard} onPress={() => setSelectedUserId(selectedUserId === user.id ? null : user.id)} activeOpacity={0.8}>
                    <View style={styles.recordMain}>
                      <View style={styles.avatar}><Text style={styles.avatarText}>{(user.full_name[0] ?? 'U').toUpperCase()}</Text></View>
                      <View style={styles.recordCopy}><Text style={styles.recordName}>{user.full_name}</Text><Text style={styles.recordMeta}>{display(user.email)} · {display(user.phone)}</Text><Text style={styles.recordSubMeta}>Joined {formatDate(user.created_at)}</Text></View>
                      <StatusPill label={user.role} tone="blue" />
                    </View>
                    {selectedUser?.id === user.id ? <View style={styles.detailsPanel}><Text style={styles.detailsHeading}>User details</Text><DetailLine label="Name" value={user.full_name} /><DetailLine label="Email" value={display(user.email)} /><DetailLine label="Phone" value={display(user.phone)} /><DetailLine label="Role" value={user.role} /><DetailLine label="Age" value={display(user.age)} /><DetailLine label="Registered" value={formatDate(user.created_at)} /><DetailLine label="User ID" value={user.id} /></View> : null}
                  </TouchableOpacity>
                ))}
                {visibleUsers.length === 0 ? <Text style={styles.emptyText}>No users match that search.</Text> : null}
              </View>
            ) : null}

            {section === 'riders' || section === 'approvals' ? (
              <View style={panelStyle}>
                <PanelHeading title={section === 'approvals' ? 'Pending rider approvals' : 'Rider management'} subtitle={section === 'approvals' ? `${pendingRiders.length} applications awaiting review` : `${riders.length} registered riders`} />
                <SearchBox value={search} onChangeText={setSearch} placeholder="Search rider, vehicle or phone" />
                {(section === 'approvals' ? pendingRiders : visibleRiders).map(renderRiderCard)}
                {(section === 'approvals' ? pendingRiders : visibleRiders).length === 0 ? <Text style={styles.emptyText}>{section === 'approvals' ? 'No pending rider applications.' : 'No riders match that search.'}</Text> : null}
              </View>
            ) : null}

            {section === 'rides' ? (
              <View style={panelStyle}>
                <PanelHeading title="Ride management" subtitle={`${rides.length} most recent rides`} />
                <SearchBox value={search} onChangeText={setSearch} placeholder="Search pickup, destination or passenger" />
                {rides.filter((ride) => {
                  const query = search.trim().toLowerCase();
                  const passenger = profileById.get(ride.passenger_id)?.full_name ?? '';
                  return !query || [ride.pickup_address, ride.destination_address, passenger].some((value) => value.toLowerCase().includes(query));
                }).map((ride) => <RideRow key={ride.id} ride={ride} passenger={profileById.get(ride.passenger_id)} rider={ride.rider_id ? profileById.get(ride.rider_id) : undefined} expanded />)}
              </View>
            ) : null}

            {section === 'payments' ? (
              <View style={panelStyle}>
                <PanelHeading title="Payments" subtitle={`${payments.length} latest payment records`} />
                <View style={styles.paymentSummaryRow}>
                  <View style={styles.paymentSummary}><Text style={styles.paymentSummaryLabel}>Paid total</Text><Text style={styles.paymentSummaryValue}>{formatMoney(stats?.totalPaid)}</Text></View>
                  <View style={styles.paymentSummary}><Text style={styles.paymentSummaryLabel}>Pending / processing</Text><Text style={styles.paymentSummaryValue}>{formatMoney(stats?.pendingPaymentAmount)}</Text></View>
                  <View style={styles.paymentSummary}><Text style={styles.paymentSummaryLabel}>Transactions</Text><Text style={styles.paymentSummaryValue}>{stats?.payments ?? '—'}</Text></View>
                </View>
                {payments.map((payment) => {
                  const compatibilityPayment = payment as Payment & { payment_status?: string };
                  const status = compatibilityPayment.payment_status ?? payment.status;
                  return (
                    <View key={payment.id} style={styles.recordCard}>
                      <View style={styles.recordMain}>
                        <View style={[styles.avatar, styles.moneyAvatar]}><Text style={styles.avatarText}>₹</Text></View>
                        <View style={styles.recordCopy}><Text style={styles.recordName}>{formatMoney(payment.amount)}</Text><Text style={styles.recordMeta}>{profileById.get(payment.user_id)?.full_name ?? 'User'} · Ride {payment.ride_id.slice(0, 8)}</Text><Text style={styles.recordSubMeta}>{formatDate(payment.created_at)}</Text></View>
                        <StatusPill label={status} tone={status === 'paid' ? 'green' : status === 'failed' || status === 'refunded' ? 'red' : 'amber'} />
                      </View>
                    </View>
                  );
                })}
                {payments.length === 0 ? <Text style={styles.emptyText}>Payment records will appear here when available.</Text> : null}
              </View>
            ) : null}

+            {section === 'earnings' ? (
              <View style={panelStyle}>
                <PanelHeading title="Rider earnings" subtitle={`${earnings.length} completed ride earnings records`} />
                <View style={styles.paymentSummaryRow}>
                  <View style={styles.paymentSummary}>
                    <Text style={styles.paymentSummaryLabel}>Gross fares</Text>
                    <Text style={styles.paymentSummaryValue}>{formatMoney(earnings.reduce((sum, row) => sum + row.gross_fare, 0))}</Text>
                  </View>
                  <View style={styles.paymentSummary}>
                    <Text style={styles.paymentSummaryLabel}>Platform fees</Text>
                    <Text style={styles.paymentSummaryValue}>{formatMoney(earnings.reduce((sum, row) => sum + row.platform_fee, 0))}</Text>
                  </View>
                  <View style={styles.paymentSummary}>
                    <Text style={styles.paymentSummaryLabel}>Rider earnings</Text>
                    <Text style={styles.paymentSummaryValue}>{formatMoney(earnings.reduce((sum, row) => sum + row.rider_earning, 0))}</Text>
                  </View>
                </View>
                {earnings.map((earning) => (
                  <View key={earning.id} style={styles.recordCard}>
                    <View style={styles.recordMain}>
                      <View style={[styles.avatar, styles.moneyAvatar]}><Text style={styles.avatarText}>₹</Text></View>
                      <View style={styles.recordCopy}>
                        <Text style={styles.recordName}>{profileById.get(earning.rider_id)?.full_name ?? 'Rider'} · {formatMoney(earning.rider_earning)}</Text>
                        <Text style={styles.recordMeta}>Ride {earning.ride_id.slice(0, 8)} · Gross {formatMoney(earning.gross_fare)} · Platform {formatMoney(earning.platform_fee)} · Tax {formatMoney(earning.tax_amount)}</Text>
                        <Text style={styles.recordSubMeta}>{formatDate(earning.created_at)}</Text>
                      </View>
                      <StatusPill label={earning.payout_status} tone={earning.payout_status === 'paid' ? 'green' : earning.payout_status === 'failed' ? 'red' : 'amber'} />
                    </View>
                    <View style={styles.payoutActions}>
                      {(['pending', 'processing', 'paid', 'failed'] as PayoutStatus[]).map((status) => (
                        <TouchableOpacity
                          key={status}
                          style={styles.payoutAction}
                          onPress={() => void handlePayoutStatus(earning.ride_id, status)}
                          disabled={busyEarningRideId !== null}
                        >
                          <Text style={styles.payoutActionText}>
                            {busyEarningRideId === earning.ride_id ? 'Saving…' : status}
                          </Text>
                        </TouchableOpacity>
                      ))}
                    </View>
                  </View>
                ))}
                {earnings.length === 0 ? <Text style={styles.emptyText}>Completed ride earnings will appear here.</Text> : null}
              </View>
            ) : null}

            {section === 'fare' ? (
              <View style={panelStyle}>
                <PanelHeading title="Fare settings" subtitle="These rates apply to new ride quotes. Existing bookings keep their saved fare." />
                <Text style={styles.fareFormula}>Total = max(base fare + distance × rate + platform fee + tax, minimum fare)</Text>
                <View style={styles.fareSettingsGrid}>
                  <FareSettingInput label="Base fare (₹)" value={fareFields.baseFare} onChange={(value) => setFareFields((current) => ({ ...current, baseFare: value }))} />
                  <FareSettingInput label="Per kilometre (₹)" value={fareFields.perKmRate} onChange={(value) => setFareFields((current) => ({ ...current, perKmRate: value }))} />
                  <FareSettingInput label="Minimum fare (₹)" value={fareFields.minimumFare} onChange={(value) => setFareFields((current) => ({ ...current, minimumFare: value }))} />
                  <FareSettingInput label="Platform fee (₹)" value={fareFields.platformFee} onChange={(value) => setFareFields((current) => ({ ...current, platformFee: value }))} />
                  <FareSettingInput label="Tax (₹)" value={fareFields.tax} onChange={(value) => setFareFields((current) => ({ ...current, tax: value }))} />
                </View>
                <Text style={styles.fareSettingsNote}>Current rate: {formatMoney(fareConfig.perKmRate)} per km. Initial rate is ₹1/km.</Text>
                <TouchableOpacity style={styles.approveButton} onPress={() => void handleFareSave()} disabled={isSavingFare}>
                  <Text style={styles.approveButtonText}>{isSavingFare ? 'Saving…' : 'Save fare settings'}</Text>
                </TouchableOpacity>
              </View>
            ) : null}


            {section === 'complaints' ? (
              <View style={panelStyle}>
                <PanelHeading title="Support requests" subtitle={`${complaints.length} recent requests`} />
                {complaints.map((complaint) => <View key={complaint.id} style={styles.recordCard}><View style={styles.recordMain}><View style={[styles.avatar, styles.supportAvatar]}><Text style={styles.avatarText}>!</Text></View><View style={styles.recordCopy}><Text style={styles.recordName}>{complaint.category} · {complaint.status}</Text><Text style={styles.recordMeta}>{complaint.description}</Text><Text style={styles.recordSubMeta}>{formatDate(complaint.created_at)}</Text></View></View>{complaint.status === 'open' ? <TouchableOpacity style={styles.approveButton} onPress={() => void handleComplaint(complaint.id)}><Text style={styles.approveButtonText}>Mark in review</Text></TouchableOpacity> : null}</View>)}
                {complaints.length === 0 ? <Text style={styles.emptyText}>No support requests.</Text> : null}
              </View>
            ) : null}

            <Text style={styles.pageFoot}>AutoWala Admin · Data access is secured by Supabase Auth and row-level security.</Text>
          </ScrollView>
        </View>
      </View>
    </SafeAreaView>
  );
}

type RiderWithLegacyLicence = { driving_license_number?: string | null; id_proof_path?: string | null; vehicle_photo_path?: string | null };

function NavItem({ item, selected, onPress, compact = false }: { item: (typeof navigation)[number]; selected: boolean; onPress: () => void; compact?: boolean }) {
  return (
    <TouchableOpacity onPress={onPress} style={[compact ? styles.mobileNavItem : styles.navItem, selected && (compact ? styles.mobileNavSelected : styles.navSelected)]} activeOpacity={0.78}>
      <Text style={[compact ? styles.mobileNavIcon : styles.navIcon, selected && styles.navTextSelected]}>{item.icon}</Text>
      <Text style={[compact ? styles.mobileNavText : styles.navText, selected && styles.navTextSelected]}>{item.label}</Text>
    </TouchableOpacity>
  );
}

function StatusPill({ label, tone }: { label: string; tone: 'green' | 'amber' | 'red' | 'blue' }) {
  return <View style={[styles.statusPill, tone === 'green' ? styles.statusGreen : tone === 'amber' ? styles.statusAmber : tone === 'red' ? styles.statusRed : styles.statusBlue]}><Text style={[styles.statusText, tone === 'green' ? styles.statusGreenText : tone === 'amber' ? styles.statusAmberText : tone === 'red' ? styles.statusRedText : styles.statusBlueText]}>{label}</Text></View>;
}

function StatCard({ label, value, caption, accent }: { label: string; value: string | number | undefined; caption: string; accent: string }) {
  return <View style={styles.statCard}><View style={[styles.statAccent, { backgroundColor: accent }]} /><Text style={styles.statLabel}>{label}</Text><Text style={styles.statValue}>{value ?? '—'}</Text><Text style={styles.statCaption}>{caption}</Text></View>;
}

function PanelHeading({ title, subtitle, actionLabel, onAction }: { title: string; subtitle: string; actionLabel?: string; onAction?: () => void }) {
  return <View style={styles.panelHeading}><View><Text style={styles.panelTitle}>{title}</Text><Text style={styles.panelSubtitle}>{subtitle}</Text></View>{actionLabel && onAction ? <TouchableOpacity onPress={onAction}><Text style={styles.panelAction}>{actionLabel}  →</Text></TouchableOpacity> : null}</View>;
}

function SearchBox({ value, onChangeText, placeholder }: { value: string; onChangeText: (text: string) => void; placeholder: string }) {
  return <TextInput value={value} onChangeText={onChangeText} style={styles.searchInput} placeholder={placeholder} placeholderTextColor="#97A19B" autoCapitalize="none" autoCorrect={false} />;
}

function FareSettingInput({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return (
    <View style={styles.fareSettingField}>
      <Text style={styles.fareSettingLabel}>{label}</Text>
      <TextInput value={value} onChangeText={onChange} style={styles.fareSettingInput} keyboardType="decimal-pad" placeholder="0.00" />
    </View>
  );
}

function DetailLine({ label, value }: { label: string; value: string }) {
  return <View style={styles.detailLine}><Text style={styles.detailLabel}>{label}</Text><Text style={styles.detailValue}>{value}</Text></View>;
}

function RideRow({ ride, passenger, rider, expanded = false }: { ride: Ride; passenger?: Profile; rider?: Profile; expanded?: boolean }) {
  return (
    <View style={styles.rideRow}>
      <View style={styles.rideRoute}><Text style={styles.rideLocation} numberOfLines={1}>{ride.pickup_address}</Text><Text style={styles.rideArrow}>↓</Text><Text style={styles.rideLocation} numberOfLines={1}>{ride.destination_address}</Text></View>
      <View style={styles.rideInfo}><Text style={styles.rideNames}>{passenger?.full_name ?? 'Passenger'}{rider ? `  ·  ${rider.full_name}` : ''}</Text><Text style={styles.rideMeta}>{ride.passenger_count} passenger(s) · {ride.vehicle_preference} · {formatDate(ride.created_at)}</Text>{expanded ? <Text style={styles.rideMeta}>Fare {formatMoney(ride.final_fare ?? ride.estimated_fare)} · Ride {ride.id}</Text> : null}</View>
      <StatusPill label={ride.status} tone={ride.status === 'completed' ? 'green' : ride.status === 'cancelled' ? 'red' : 'blue'} />
    </View>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: '#F4F6F8' },
  appFrame: { flex: 1, flexDirection: 'row', backgroundColor: '#F4F6F8' },
  appFrameMobile: { flexDirection: 'column' },
  sidebar: { width: 246, backgroundColor: '#17241F', paddingTop: 27, paddingHorizontal: 16 },
  sidebarBrand: { flexDirection: 'row', alignItems: 'center', gap: 11, paddingHorizontal: 8, marginBottom: 48 },
  sidebarLogo: { width: 39, height: 39, borderRadius: 12, backgroundColor: '#C5EDD2', alignItems: 'center', justifyContent: 'center' },
  sidebarLogoText: { color: '#1E6A43', fontSize: 21, fontWeight: '900' },
  sidebarTitle: { color: '#F8FAF8', fontWeight: '800', fontSize: 16 },
  sidebarCaption: { color: '#8FA498', fontWeight: '800', fontSize: 8, letterSpacing: 1.4, marginTop: 4 },
  navSectionLabel: { color: '#71857A', fontSize: 9, fontWeight: '900', letterSpacing: 1.5, paddingHorizontal: 11, marginBottom: 10 },
  sideNav: { gap: 5 },
  navItem: { minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: 13, paddingHorizontal: 12, borderRadius: 9 },
  navSelected: { backgroundColor: '#263D32' },
  navIcon: { width: 18, textAlign: 'center', fontSize: 18, color: '#9BAAA1' },
  navText: { color: '#B7C2BC', fontSize: 12, fontWeight: '600' },
  navTextSelected: { color: '#D3F2DD', fontWeight: '800' },
  sidebarFooter: { flexDirection: 'row', alignItems: 'center', gap: 10, borderTopWidth: 1, borderTopColor: '#2B3A33', paddingTop: 17, paddingBottom: 18, marginTop: 'auto', marginBottom: 8 },
  accountDot: { width: 32, height: 32, borderRadius: 16, backgroundColor: '#335643', alignItems: 'center', justifyContent: 'center' },
  accountDotText: { color: '#DCF4E5', fontSize: 12, fontWeight: '800' },
  sidebarAccount: { flex: 1 },
  sidebarAccountName: { color: '#F1F5F2', fontSize: 11, fontWeight: '700' },
  sidebarAccountRole: { color: '#93A69B', fontSize: 10, marginTop: 3 },
  sidebarLogout: { padding: 8 },
  sidebarLogoutText: { color: '#AEBBB3', fontSize: 19 },
  main: { flex: 1, minWidth: 0 },
  topBar: { minHeight: 91, backgroundColor: '#FFFFFF', borderBottomWidth: 1, borderBottomColor: '#E8ECE9', paddingHorizontal: 34, paddingVertical: 16, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  topBarMobile: { minHeight: 72, paddingHorizontal: 16, paddingVertical: 11 },
  breadcrumb: { color: '#98A39C', fontSize: 9, fontWeight: '800', letterSpacing: 1.15, marginBottom: 6 },
  pageTitle: { color: '#1E2923', fontSize: 23, fontWeight: '800', letterSpacing: -0.4 },
  topActions: { flexDirection: 'row', alignItems: 'center', gap: 18 },
  topAccount: { color: '#68756D', fontSize: 11 },
  refreshButton: { height: 36, borderWidth: 1, borderColor: '#DEE5E0', borderRadius: 9, paddingHorizontal: 12, alignItems: 'center', justifyContent: 'center' },
  refreshButtonText: { color: '#34423A', fontSize: 11, fontWeight: '700' },
  pageScroll: { flex: 1 },
  pageContent: { width: '100%', maxWidth: 1480, alignSelf: 'center', paddingHorizontal: 34, paddingTop: 27, paddingBottom: 35 },
  pageContentMobile: { paddingHorizontal: 13, paddingTop: 17, paddingBottom: 26 },
  welcomeBlock: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 22 },
  welcomeTitle: { color: '#1C2922', fontSize: 21, fontWeight: '800', letterSpacing: -0.4 },
  welcomeSub: { color: '#7F8A83', fontSize: 12, marginTop: 5 },
  dateBadge: { backgroundColor: '#FFFFFF', borderWidth: 1, borderColor: '#E6EBE7', borderRadius: 9, paddingHorizontal: 12, paddingVertical: 9 },
  dateBadgeText: { color: '#5D6B62', fontSize: 10, fontWeight: '700' },
  statsGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
  statCard: { flexGrow: 1, flexBasis: 175, minHeight: 128, backgroundColor: '#FFFFFF', borderWidth: 1, borderColor: '#E6EBE8', borderRadius: 13, padding: 15, overflow: 'hidden' },
  statAccent: { width: 24, height: 3, borderRadius: 2, marginBottom: 12 },
  statLabel: { color: '#78847D', fontSize: 11, fontWeight: '600' },
  statValue: { color: '#1E2923', fontSize: 23, fontWeight: '800', marginTop: 5 },
  statCaption: { color: '#A0AAA4', fontSize: 10, marginTop: 6 },
  dashboardColumns: { flexDirection: 'row', flexWrap: 'wrap', gap: 16, marginTop: 17 },
  panel: { flex: 1, minWidth: 320, backgroundColor: '#FFFFFF', borderWidth: 1, borderColor: '#E5EAE7', borderRadius: 14, padding: 18 },
  panelMobile: { minWidth: 0, padding: 13 },
  panelHeading: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 17 },
  panelTitle: { color: '#25312A', fontSize: 14, fontWeight: '800' },
  panelSubtitle: { color: '#929D96', fontSize: 10, marginTop: 5 },
  panelAction: { color: '#238150', fontSize: 10, fontWeight: '800' },
  recordCard: { borderWidth: 1, borderColor: '#EDF0EE', borderRadius: 11, padding: 12, marginBottom: 9, backgroundColor: '#FFFFFF' },
  recordMain: { flexDirection: 'row', alignItems: 'center', gap: 11 },
  avatar: { width: 37, height: 37, borderRadius: 12, backgroundColor: '#E9F0FC', alignItems: 'center', justifyContent: 'center' },
  riderAvatar: { backgroundColor: '#E6F5EC' },
  moneyAvatar: { backgroundColor: '#E1F2F1' },
  supportAvatar: { backgroundColor: '#FFF4DF' },
  avatarText: { color: '#486AA0', fontSize: 13, fontWeight: '900' },
  recordCopy: { flex: 1, minWidth: 0 },
  recordName: { color: '#29362E', fontSize: 12, fontWeight: '800' },
  recordMeta: { color: '#69766E', fontSize: 10, marginTop: 4 },
  recordSubMeta: { color: '#98A39B', fontSize: 9, marginTop: 4 },
  statusPill: { alignSelf: 'flex-start', borderRadius: 20, paddingHorizontal: 9, paddingVertical: 5, flexShrink: 0 },
  statusText: { fontSize: 9, fontWeight: '800', textTransform: 'capitalize' },
  statusGreen: { backgroundColor: '#E6F5EB' }, statusGreenText: { color: '#227746' },
  statusAmber: { backgroundColor: '#FFF4DB' }, statusAmberText: { color: '#9C7015' },
  statusRed: { backgroundColor: '#FDECEB' }, statusRedText: { color: '#A4433F' },
  statusBlue: { backgroundColor: '#EAF1FD' }, statusBlueText: { color: '#456CB0' },
  actionRow: { flexDirection: 'row', gap: 8, marginTop: 12, marginLeft: 48 },
  approveButton: { minHeight: 34, backgroundColor: '#198754', borderRadius: 8, paddingHorizontal: 12, alignItems: 'center', justifyContent: 'center', alignSelf: 'flex-start' },
  approveButtonText: { color: '#FFFFFF', fontSize: 10, fontWeight: '800' },
  rejectButton: { minHeight: 34, backgroundColor: '#FFFFFF', borderWidth: 1, borderColor: '#E6C5C1', borderRadius: 8, paddingHorizontal: 12, alignItems: 'center', justifyContent: 'center' },
  rejectButtonText: { color: '#A4423D', fontSize: 10, fontWeight: '800' },
  detailsPanel: { backgroundColor: '#F8FAF8', borderRadius: 9, padding: 13, marginTop: 12 },
  detailsHeading: { color: '#344139', fontSize: 11, fontWeight: '800', marginBottom: 9 },
  detailLine: { flexDirection: 'row', justifyContent: 'space-between', gap: 15, paddingVertical: 5, borderBottomWidth: 1, borderBottomColor: '#E9EEEA' },
  detailLabel: { color: '#87938B', fontSize: 10 },
  detailValue: { color: '#354239', fontSize: 10, fontWeight: '600', flexShrink: 1, textAlign: 'right' },
  documentTitle: { color: '#506056', fontSize: 10, fontWeight: '800', marginTop: 11, marginBottom: 4 },
  documentLink: { paddingVertical: 5 },
  documentLinkText: { color: '#237A4A', fontSize: 10, fontWeight: '700' },
  muted: { color: '#98A29C', fontSize: 10, marginTop: 5 },
  emptyText: { color: '#98A29C', backgroundColor: '#FAFBFA', borderRadius: 9, padding: 15, fontSize: 11 },
  searchInput: { height: 40, backgroundColor: '#FAFBFA', borderWidth: 1, borderColor: '#E5EAE7', borderRadius: 9, paddingHorizontal: 12, color: '#354239', fontSize: 11, marginBottom: 14 },
  rideRow: { flexDirection: 'row', alignItems: 'center', gap: 14, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: '#EEF1EF' },
  rideRoute: { flex: 1, minWidth: 120 },
  rideLocation: { color: '#36433B', fontSize: 10, fontWeight: '700' },
  rideArrow: { color: '#A6B0AA', fontSize: 11, marginVertical: 2 },
  rideInfo: { flex: 1.3, minWidth: 140 },
  rideNames: { color: '#546158', fontSize: 10, fontWeight: '700' },
  rideMeta: { color: '#929D96', fontSize: 9, marginTop: 4 },
  paymentSummaryRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginBottom: 15 },
  paymentSummary: { flexGrow: 1, flexBasis: 130, backgroundColor: '#F8FAF8', borderRadius: 9, padding: 12 },
  paymentSummaryLabel: { color: '#849087', fontSize: 9, fontWeight: '700' },
  paymentSummaryValue: { color: '#26372D', fontSize: 17, fontWeight: '800', marginTop: 5 },
  payoutActions: { flexDirection: 'row', flexWrap: 'wrap', gap: 7, marginTop: 12 },
  payoutAction: { borderWidth: 1, borderColor: '#D9E3DC', borderRadius: 8, paddingHorizontal: 10, paddingVertical: 7 },
  payoutActionText: { color: '#355341', fontSize: 11, fontWeight: '700', textTransform: 'capitalize' },
  fareFormula: { color: '#56645A', fontSize: 13, lineHeight: 19, backgroundColor: '#F5F8F5', borderRadius: 10, padding: 12, marginBottom: 15 },
  fareSettingsGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
  fareSettingField: { width: '48%', minWidth: 140, flexGrow: 1 },
  fareSettingLabel: { color: '#536057', fontSize: 12, fontWeight: '700', marginBottom: 6 },
  fareSettingInput: { minHeight: 46, borderWidth: 1, borderColor: '#DCE4DE', borderRadius: 9, backgroundColor: '#FFF', paddingHorizontal: 12, color: '#213027' },
  fareSettingsNote: { color: '#768279', fontSize: 12, marginTop: 12 },
  alertError: { color: '#963D38', backgroundColor: '#FCEDEC', borderColor: '#F2D1CE', borderWidth: 1, borderRadius: 9, padding: 12, fontSize: 11, marginBottom: 12 },
  alertSuccess: { color: '#246C42', backgroundColor: '#EAF6EE', borderColor: '#CBE8D4', borderWidth: 1, borderRadius: 9, padding: 12, fontSize: 11, marginBottom: 12 },
  firstLoad: { marginVertical: 30 },
  pageFoot: { color: '#9DA7A1', fontSize: 9, textAlign: 'center', paddingVertical: 24 },
  loadingScreen: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12, backgroundColor: '#F4F6F8' },
  loadingText: { color: '#7A887F', fontSize: 12 },
  mobileNavWrap: { backgroundColor: '#17241F', paddingTop: 13 },
  mobileBrandRow: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 15, paddingBottom: 12, gap: 9 },
  mobileBrandCopy: { flex: 1 },
  mobileLogout: { padding: 8 },
  mobileLogoutText: { color: '#D3E5D9', fontSize: 10, fontWeight: '700' },
  mobileNav: { paddingHorizontal: 12, paddingBottom: 9, gap: 5 },
  mobileNavItem: { minHeight: 34, flexDirection: 'row', alignItems: 'center', gap: 6, borderRadius: 8, paddingHorizontal: 10, backgroundColor: 'transparent' },
  mobileNavSelected: { backgroundColor: '#2A4435' },
  mobileNavIcon: { color: '#AABAB0', fontSize: 13 },
  mobileNavText: { color: '#BFCCC4', fontSize: 10, fontWeight: '700' },
});
