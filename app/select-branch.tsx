import { Ionicons, MaterialCommunityIcons } from "@expo/vector-icons";
import * as Location from "expo-location";
import { useRouter } from "expo-router";
import { useEffect, useRef, useState } from "react";
import { Animated, PanResponder, Pressable, StyleSheet, Text, View } from "react-native";

import { AmbientTop } from "@/components/ambient-top";
import { KitchenMark } from "@/components/kitchen-mark";
import { useSession } from "@/contexts/session-context";
import { useResponsiveInset } from "@/hooks/use-responsive";
import { saveEmployeeBranch } from "@/lib/attendance";
import { Branch, LocationPoint, findNearestBranch } from "@/lib/branches";

const LOCATING_STEPS = [
  "Checking your GPS location...",
  "Finding nearby Thyme In branch...",
  "Matching your location with branch data...",
];

const FALLBACK_LOCATION = { lat: 14.5547, lng: 121.0244 };

export default function SelectBranch() {
  const router = useRouter();
  const inset = useResponsiveInset(22);
  const { employee, setSelectedBranch, setLatestLocation } = useSession();

  const [isLocating, setIsLocating] = useState(true);
  const [statusIndex, setStatusIndex] = useState(0);
  const [detectedBranch, setDetectedBranch] = useState<Branch | null>(null);
  const [scanId, setScanId] = useState(0);
  const [sliderWidth, setSliderWidth] = useState(0);
  const [isPunchingIn, setIsPunchingIn] = useState(false);
  const [isPunchSuccess, setIsPunchSuccess] = useState(false);
  const [hasConfirmedLocation, setHasConfirmedLocation] = useState(false);
  const [hasConfirmedBranch, setHasConfirmedBranch] = useState(false);
  const [locationError, setLocationError] = useState("");
  const [userLocation, setUserLocation] = useState<LocationPoint | null>(null);

  const pinScale = useRef(new Animated.Value(1)).current;
  const rippleScale = useRef(new Animated.Value(0.8)).current;
  const rippleOpacity = useRef(new Animated.Value(0.35)).current;
  const sliderX = useRef(new Animated.Value(0)).current;
  const sliderXValue = useRef(0);
  const dragStartX = useRef(0);
  const navigateTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const locationWatcherRef = useRef<Location.LocationSubscription | null>(null);
  const hasConfirmedBranchRef = useRef(false);
  const KNOB_SIZE = 50;

  useEffect(() => {
    if (!employee) {
      router.replace("/login");
    }
  }, [employee, router]);

  useEffect(() => {
    const pinLoop = Animated.loop(
      Animated.sequence([
        Animated.timing(pinScale, {
          toValue: 1.14,
          duration: 720,
          useNativeDriver: true,
        }),
        Animated.timing(pinScale, {
          toValue: 1,
          duration: 720,
          useNativeDriver: true,
        }),
      ]),
    );

    const rippleLoop = Animated.loop(
      Animated.sequence([
        Animated.parallel([
          Animated.timing(rippleScale, {
            toValue: 1.2,
            duration: 1250,
            useNativeDriver: true,
          }),
          Animated.timing(rippleOpacity, {
            toValue: 0.08,
            duration: 1250,
            useNativeDriver: true,
          }),
        ]),
        Animated.parallel([
          Animated.timing(rippleScale, {
            toValue: 0.8,
            duration: 0,
            useNativeDriver: true,
          }),
          Animated.timing(rippleOpacity, {
            toValue: 0.35,
            duration: 0,
            useNativeDriver: true,
          }),
        ]),
      ]),
    );

    pinLoop.start();
    rippleLoop.start();

    return () => {
      pinLoop.stop();
      rippleLoop.stop();
    };
  }, [pinScale, rippleOpacity, rippleScale]);

  useEffect(() => {
    hasConfirmedBranchRef.current = hasConfirmedBranch;
  }, [hasConfirmedBranch]);

  useEffect(() => {
    setIsLocating(true);
    setDetectedBranch(null);
    setStatusIndex(0);
    setIsPunchingIn(false);
    setIsPunchSuccess(false);
    setHasConfirmedLocation(false);
    setHasConfirmedBranch(false);
    setLocationError("");
    setUserLocation(null);
    sliderX.setValue(0);

    if (navigateTimerRef.current) {
      clearTimeout(navigateTimerRef.current);
      navigateTimerRef.current = null;
    }

    const stepTimer = setInterval(() => {
      setStatusIndex((prev) => (prev < LOCATING_STEPS.length - 1 ? prev + 1 : prev));
    }, 850);

    let isCancelled = false;

    const detectLocation = async () => {
      try {
        const permission = await Location.requestForegroundPermissionsAsync();

        if (permission.status !== "granted") {
          setLocationError("Location permission denied. Using approximate branch.");
          const nearest = findNearestBranch(FALLBACK_LOCATION);
          if (!isCancelled) {
            setDetectedBranch(nearest);
            setUserLocation(FALLBACK_LOCATION);
            setStatusIndex(LOCATING_STEPS.length - 1);
            setIsLocating(false);
          }
          return;
        }

        const current = await Location.getCurrentPositionAsync({
          accuracy: Location.Accuracy.High,
        });

        const normalizedLocation: LocationPoint = {
          lat: current.coords.latitude,
          lng: current.coords.longitude,
          accuracyMeters: current.coords.accuracy,
        };

        if (!isCancelled) {
          setUserLocation(normalizedLocation);
          setDetectedBranch(findNearestBranch(normalizedLocation));
          setStatusIndex(LOCATING_STEPS.length - 1);
          setIsLocating(false);
        }

        locationWatcherRef.current = await Location.watchPositionAsync(
          {
            accuracy: Location.Accuracy.Balanced,
            distanceInterval: 15,
            timeInterval: 10000,
          },
          (position) => {
            const nextLocation: LocationPoint = {
              lat: position.coords.latitude,
              lng: position.coords.longitude,
              accuracyMeters: position.coords.accuracy,
            };
            setUserLocation(nextLocation);
            setDetectedBranch((currentBranch) => {
              if (hasConfirmedBranchRef.current && currentBranch) return currentBranch;
              return findNearestBranch(nextLocation);
            });
          },
        );
      } catch (error) {
        console.error(error);
        const nearest = findNearestBranch(FALLBACK_LOCATION);
        if (!isCancelled) {
          setLocationError("Unable to read live GPS. Using fallback branch.");
          setDetectedBranch(nearest);
          setUserLocation(FALLBACK_LOCATION);
          setStatusIndex(LOCATING_STEPS.length - 1);
          setIsLocating(false);
        }
      } finally {
        clearInterval(stepTimer);
      }
    };

    detectLocation();

    return () => {
      isCancelled = true;
      clearInterval(stepTimer);
      if (locationWatcherRef.current) {
        locationWatcherRef.current.remove();
        locationWatcherRef.current = null;
      }
    };
  }, [scanId, sliderX]);

  useEffect(() => {
    return () => {
      if (navigateTimerRef.current) {
        clearTimeout(navigateTimerRef.current);
      }
      if (locationWatcherRef.current) {
        locationWatcherRef.current.remove();
        locationWatcherRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    const id = sliderX.addListener(({ value }) => {
      sliderXValue.current = value;
    });

    return () => sliderX.removeListener(id);
  }, [sliderX]);

  const swipeRange = Math.max(0, sliderWidth - KNOB_SIZE - 8);
  const swipeThreshold = swipeRange * 0.72;
  const isReadyToSwipe = Boolean(detectedBranch) && hasConfirmedLocation && hasConfirmedBranch;
  const isSwipeDisabled = !isReadyToSwipe || isPunchingIn || isPunchSuccess;
  const thumbIconColor = isPunchSuccess ? "#8FA89A" : isSwipeDisabled ? "#8FA89A" : "#059669";

  const resetSlider = () => {
    Animated.spring(sliderX, {
      toValue: 0,
      bounciness: 8,
      useNativeDriver: true,
    }).start();
  };

  const completePunchIn = () => {
    if (!employee || !detectedBranch || !isReadyToSwipe || isPunchingIn || isPunchSuccess) return;

    setIsPunchingIn(true);
    Animated.timing(sliderX, {
      toValue: swipeRange,
      duration: 140,
      useNativeDriver: true,
    }).start(async () => {
      try {
        await saveEmployeeBranch(employee.employeeId, detectedBranch);
        setSelectedBranch(detectedBranch);
        setLatestLocation(userLocation);

        setIsPunchingIn(false);
        setIsPunchSuccess(true);
        navigateTimerRef.current = setTimeout(() => {
          router.replace("/employee/dashboard");
        }, 950);
      } catch (error) {
        setIsPunchingIn(false);
        setIsPunchSuccess(false);
        setLocationError("Unable to save selected branch. Please try again.");
        console.error(error);
        resetSlider();
      }
    });
  };

  const panResponder = PanResponder.create({
    onStartShouldSetPanResponder: () => isReadyToSwipe && !isPunchingIn,
    onMoveShouldSetPanResponder: (_, gestureState) =>
      isReadyToSwipe && !isPunchingIn && Math.abs(gestureState.dx) > 2,
    onPanResponderGrant: () => {
      dragStartX.current = sliderXValue.current;
    },
    onPanResponderMove: (_, gestureState) => {
      if (!isReadyToSwipe || isPunchingIn) return;
      const nextValue = Math.max(0, Math.min(swipeRange, dragStartX.current + gestureState.dx));
      sliderX.setValue(nextValue);
    },
    onPanResponderRelease: (_, gestureState) => {
      if (!isReadyToSwipe || isPunchingIn) return;
      const releasedAt = Math.max(0, Math.min(swipeRange, dragStartX.current + gestureState.dx));
      if (releasedAt >= swipeThreshold) {
        completePunchIn();
        return;
      }
      resetSlider();
    },
    onPanResponderTerminate: resetSlider,
    onPanResponderTerminationRequest: () => false,
  });

  const onSliderLayout = (event: { nativeEvent: { layout: { width: number } } }) => {
    setSliderWidth(event.nativeEvent.layout.width);
  };

  const stepNumber = (() => {
    if (isPunchSuccess) return 3;
    if (isReadyToSwipe) return 3;
    if (detectedBranch) return 2;
    return 1;
  })();

  const locationMeta = userLocation
    ? `${userLocation.lat.toFixed(5)}, ${userLocation.lng.toFixed(5)}`
    : "Waiting for location...";

  return (
    <View style={[styles.screen, { paddingHorizontal: inset }]}>
      <AmbientTop height={280} />

      <View style={styles.topRow}>
        <Pressable style={styles.backBtn} onPress={() => router.back()} hitSlop={8}>
          <Ionicons name="chevron-back" size={20} color="#0B2A1E" />
        </Pressable>
        <View style={styles.stepIndicator}>
          <View style={styles.stepProgress}>
            <View style={[styles.stepDot, stepNumber >= 1 && styles.stepDotActive]} />
            <View style={[styles.stepLine, stepNumber >= 2 && styles.stepLineActive]} />
            <View style={[styles.stepDot, stepNumber >= 2 && styles.stepDotActive]} />
            <View style={[styles.stepLine, stepNumber >= 3 && styles.stepLineActive]} />
            <View style={[styles.stepDot, stepNumber >= 3 && styles.stepDotActive]} />
          </View>
        </View>
        <View style={styles.brandSlot}>
          <KitchenMark size={40} />
        </View>
      </View>

      <View style={styles.headerWrap}>
        <Text style={styles.eyebrow}>Location Check</Text>
        <Text style={styles.pageTitle}>Auto Branch Detection</Text>
        <Text style={styles.pageSubtitle}>
          We will detect your location and assign your nearest working branch.
        </Text>
      </View>

      <Pressable
        style={[
          styles.mapArea,
          detectedBranch && styles.mapAreaDetected,
          hasConfirmedLocation && styles.mapAreaSelected,
        ]}
        onPress={() => {
          if (!detectedBranch || isPunchingIn) return;
          setHasConfirmedLocation(true);
        }}
      >
        <Animated.View
          style={[
            styles.ripple,
            {
              transform: [{ scale: isLocating ? rippleScale : 1 }],
              opacity: isLocating ? rippleOpacity : 0,
            },
          ]}
        />
        <Animated.View
          style={[
            styles.rippleOuter,
            {
              transform: [{ scale: isLocating ? rippleScale : 1 }],
              opacity: isLocating ? rippleOpacity : 0,
            },
          ]}
        />

        <Animated.View style={{ transform: [{ scale: isLocating ? pinScale : 1 }] }}>
          <View style={styles.pinShadow}>
            <MaterialCommunityIcons name="map-marker" size={78} color="#059669" />
          </View>
        </Animated.View>
        {hasConfirmedLocation && (
          <View style={styles.confirmBadge}>
            <Ionicons name="checkmark" size={14} color="#ffffff" />
          </View>
        )}
      </Pressable>

      <View style={styles.statusPill}>
        {isLocating ? (
          <View style={styles.statusDotPulse} />
        ) : (
          <Ionicons name="checkmark-circle" size={14} color="#16A34A" />
        )}
        <Text style={styles.statusLabel}>
          {isLocating ? LOCATING_STEPS[statusIndex] : "Branch detected"}
        </Text>
      </View>

      <Text style={styles.locationMeta}>{locationMeta}</Text>
      {locationError ? <Text style={styles.locationError}>{locationError}</Text> : null}

      {detectedBranch ? (
        <Pressable
          style={[styles.branchCard, hasConfirmedBranch && styles.branchCardSelected]}
          onPress={() => {
            if (isPunchingIn) return;
            setHasConfirmedLocation(true);
            setHasConfirmedBranch(true);
          }}
        >
          <View style={styles.branchIconWrap}>
            <Ionicons name="business" size={20} color="#059669" />
          </View>
          <View style={styles.branchInfo}>
            <Text style={styles.branchName}>{detectedBranch.name}</Text>
            <View style={styles.branchAddressRow}>
              <Ionicons name="location-outline" size={12} color="#8FA89A" />
              <Text style={styles.branchAddress} numberOfLines={1}>
                {detectedBranch.address}
              </Text>
            </View>
          </View>
          {hasConfirmedBranch ? (
            <View style={styles.branchConfirmedBadge}>
              <Ionicons name="checkmark" size={14} color="#ffffff" />
            </View>
          ) : (
            <View style={styles.branchTapHint}>
              <Text style={styles.branchTapHintText}>Tap</Text>
            </View>
          )}
        </Pressable>
      ) : (
        <View style={styles.placeholderCard}>
          <Text style={styles.placeholderText}>Detecting your nearest branch...</Text>
        </View>
      )}

      {detectedBranch && !isReadyToSwipe && (
        <View style={styles.selectionHintWrap}>
          <Ionicons name="information-circle" size={13} color="#059669" />
          <Text style={styles.selectionHint}>Tap the card to confirm and unlock swipe</Text>
        </View>
      )}

      <View
        style={[
          styles.swipeTrack,
          isPunchSuccess
            ? styles.swipeTrackSuccess
            : isSwipeDisabled
              ? styles.swipeTrackDisabled
              : styles.swipeTrackReady,
        ]}
        onLayout={onSliderLayout}
      >
        <Text
          style={[
            styles.swipeLabel,
            !isSwipeDisabled && styles.swipeLabelReady,
            isPunchSuccess && styles.swipeLabelSuccess,
          ]}
        >
          {isPunchingIn
            ? "Punching in..."
            : isPunchSuccess
              ? "Successfully Punched In"
              : isReadyToSwipe
                ? "Swipe to Continue"
                : "Confirm location and branch"}
        </Text>
        <Animated.View
          style={[
            styles.swipeThumb,
            isSwipeDisabled && styles.swipeThumbDisabled,
            !isSwipeDisabled && styles.swipeThumbReady,
            isPunchSuccess && styles.swipeThumbSuccess,
            { transform: [{ translateX: sliderX }] },
          ]}
          {...panResponder.panHandlers}
        >
          {isPunchSuccess ? (
            <Ionicons name="checkmark" size={22} color={thumbIconColor} />
          ) : (
            <Ionicons name="chevron-forward" size={22} color={thumbIconColor} />
          )}
        </Animated.View>
      </View>

      <Pressable style={styles.secondaryButton} onPress={() => setScanId((prev) => prev + 1)}>
        <Ionicons name="refresh" size={14} color="#44604F" />
        <Text style={styles.secondaryButtonText}>Scan again</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: "#F2FBF6",
    paddingTop: 60,
  },
  topRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 22,
  },
  backBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: "#ffffff",
    alignItems: "center",
    justifyContent: "center",
    shadowColor: "#0B2A1E",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06,
    shadowRadius: 8,
    elevation: 2,
    borderWidth: 1,
    borderColor: "rgba(11, 42, 30, 0.04)",
  },
  brandSlot: {
    width: 40,
    height: 40,
    alignItems: "center",
    justifyContent: "center",
  },
  stepIndicator: {
    flex: 1,
    alignItems: "center",
  },
  stepProgress: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
  },
  stepDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: "#C6E8D5",
  },
  stepDotActive: {
    backgroundColor: "#059669",
  },
  stepLine: {
    width: 24,
    height: 2,
    borderRadius: 1,
    backgroundColor: "#C6E8D5",
  },
  stepLineActive: {
    backgroundColor: "#059669",
  },
  headerWrap: {
    alignItems: "center",
    gap: 6,
  },
  eyebrow: {
    fontSize: 11,
    fontWeight: "600",
    color: "#059669",
    letterSpacing: 2,
    textTransform: "uppercase",
  },
  pageTitle: {
    textAlign: "center",
    fontSize: 26,
    fontWeight: "700",
    color: "#0B2A1E",
    letterSpacing: -0.5,
    marginTop: 2,
  },
  pageSubtitle: {
    textAlign: "center",
    marginTop: 4,
    marginHorizontal: 12,
    fontSize: 14,
    lineHeight: 20,
    color: "#5A7264",
  },
  mapArea: {
    marginTop: 32,
    alignSelf: "center",
    width: 200,
    height: 200,
    borderRadius: 100,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#ffffff",
    borderWidth: 1,
    borderColor: "rgba(11, 42, 30, 0.06)",
    shadowColor: "#0B2A1E",
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.05,
    shadowRadius: 20,
    elevation: 3,
  },
  mapAreaDetected: {
    borderColor: "rgba(5, 150, 105, 0.18)",
  },
  mapAreaSelected: {
    borderColor: "#059669",
    borderWidth: 2,
  },
  ripple: {
    position: "absolute",
    width: 170,
    height: 170,
    borderRadius: 85,
    backgroundColor: "rgba(5, 150, 105, 0.12)",
  },
  rippleOuter: {
    position: "absolute",
    width: 200,
    height: 200,
    borderRadius: 100,
    borderWidth: 1.5,
    borderColor: "rgba(5, 150, 105, 0.2)",
  },
  pinShadow: {
    shadowColor: "#059669",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 10,
    elevation: 4,
  },
  confirmBadge: {
    position: "absolute",
    top: 18,
    right: 18,
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: "#16A34A",
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 2.5,
    borderColor: "#ffffff",
  },
  statusPill: {
    marginTop: 24,
    alignSelf: "center",
    flexDirection: "row",
    alignItems: "center",
    gap: 7,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 20,
    backgroundColor: "#ffffff",
    shadowColor: "#0B2A1E",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.04,
    shadowRadius: 8,
    elevation: 2,
    borderWidth: 1,
    borderColor: "rgba(11, 42, 30, 0.04)",
  },
  statusDotPulse: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: "#059669",
  },
  statusLabel: {
    fontSize: 12,
    fontWeight: "600",
    color: "#1E3A2C",
  },
  locationMeta: {
    marginTop: 10,
    textAlign: "center",
    fontSize: 12,
    color: "#5A7264",
    fontWeight: "500",
  },
  locationError: {
    marginTop: 6,
    textAlign: "center",
    fontSize: 12,
    color: "#B91C1C",
    fontWeight: "600",
  },
  branchCard: {
    marginTop: 16,
    borderRadius: 18,
    backgroundColor: "#ffffff",
    padding: 16,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    shadowColor: "#0B2A1E",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.06,
    shadowRadius: 14,
    elevation: 3,
    borderWidth: 1,
    borderColor: "rgba(11, 42, 30, 0.04)",
  },
  branchCardSelected: {
    borderWidth: 1.5,
    borderColor: "#059669",
  },
  branchIconWrap: {
    width: 44,
    height: 44,
    borderRadius: 12,
    backgroundColor: "rgba(5, 150, 105, 0.08)",
    alignItems: "center",
    justifyContent: "center",
  },
  branchInfo: {
    flex: 1,
    gap: 3,
  },
  branchConfirmedBadge: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: "#16A34A",
    alignItems: "center",
    justifyContent: "center",
  },
  branchTapHint: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 8,
    backgroundColor: "#DAF1E6",
    borderWidth: 1,
    borderColor: "#C6E8D5",
  },
  branchTapHintText: {
    fontSize: 10,
    fontWeight: "700",
    color: "#44604F",
    letterSpacing: 1.2,
    textTransform: "uppercase",
  },
  branchName: {
    fontSize: 15,
    fontWeight: "700",
    color: "#0B2A1E",
    letterSpacing: -0.2,
  },
  branchAddressRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
  },
  branchAddress: {
    flex: 1,
    fontSize: 12,
    color: "#8FA89A",
  },
  placeholderCard: {
    marginTop: 16,
    borderRadius: 18,
    backgroundColor: "#ffffff",
    paddingVertical: 26,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: "#C6E8D5",
    borderStyle: "dashed",
  },
  placeholderText: {
    fontSize: 13,
    color: "#8FA89A",
    fontWeight: "500",
  },
  selectionHintWrap: {
    marginTop: 12,
    flexDirection: "row",
    justifyContent: "center",
    alignItems: "center",
    gap: 5,
  },
  selectionHint: {
    color: "#059669",
    fontSize: 12,
    fontWeight: "500",
  },
  swipeTrack: {
    marginTop: 24,
    height: 58,
    borderRadius: 29,
    justifyContent: "center",
    paddingHorizontal: 6,
    overflow: "hidden",
    borderWidth: 1,
  },
  swipeTrackDisabled: {
    backgroundColor: "#DAF1E6",
    borderColor: "#C6E8D5",
  },
  swipeTrackReady: {
    backgroundColor: "#059669",
    borderColor: "#047857",
    shadowColor: "#059669",
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.25,
    shadowRadius: 14,
    elevation: 6,
  },
  swipeTrackSuccess: {
    backgroundColor: "#16A34A",
    borderColor: "#0E8E3F",
    shadowColor: "#16A34A",
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.25,
    shadowRadius: 14,
    elevation: 6,
  },
  swipeLabel: {
    textAlign: "center",
    color: "#8FA89A",
    fontSize: 14,
    fontWeight: "600",
    letterSpacing: 0.3,
  },
  swipeLabelReady: {
    color: "#ffffff",
    fontWeight: "600",
  },
  swipeLabelSuccess: {
    color: "#ffffff",
    fontWeight: "700",
  },
  swipeThumb: {
    position: "absolute",
    left: 4,
    width: 50,
    height: 50,
    borderRadius: 25,
    backgroundColor: "#ffffff",
    alignItems: "center",
    justifyContent: "center",
    shadowColor: "#0B2A1E",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15,
    shadowRadius: 8,
    elevation: 4,
  },
  swipeThumbDisabled: {
    opacity: 0.85,
  },
  swipeThumbReady: {},
  swipeThumbSuccess: {
    opacity: 1,
  },
  secondaryButton: {
    marginTop: 16,
    alignSelf: "center",
    height: 40,
    borderRadius: 20,
    paddingHorizontal: 18,
    borderWidth: 1,
    borderColor: "#C6E8D5",
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: "#ffffff",
  },
  secondaryButtonText: {
    color: "#44604F",
    fontSize: 13,
    fontWeight: "600",
    letterSpacing: 0.2,
  },
});

