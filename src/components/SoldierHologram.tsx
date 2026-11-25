import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import type { PointCloudData } from '../utils/pointCloud';
import type { BackgroundPointCloudData } from '../utils/backgroundPointCloud';
import type { HologramAudioEngine } from '../utils/audioEngine';
import type { HologramVisualMood, PipelinePhase } from '../types/voicePersona';
import { advanceAssemblyProgress, easeInOutSine, easeOutCubic } from '../utils/hologramConfig';

interface SoldierHologramProps {
  pointCloud: PointCloudData;
  backgroundCloud: BackgroundPointCloudData | null;
  audioEngine: HologramAudioEngine;
  phase: PipelinePhase;
  visualMood: HologramVisualMood;
  bargeInPulseNonce: number;
  modelMode: 'placeholder' | 'glb';
  isOpen: boolean;
  onSoftwareGlDetected?: (isSoftware: boolean) => void;
}

const AVATAR_VERTEX_SHADER = /* glsl */ `
  attribute float aPhase;
  attribute float aSize;
  attribute float aMouthWeight;
  attribute float aJawWeight;
  attribute float aFade;

  uniform float uTime;
  uniform float uAssemble;
  uniform float uJawOpen;
  uniform float uGlowBoost;
  uniform float uMicLevel;
  uniform float uThinking;
  uniform float uBargeIn;
  uniform float uDispersion;
  uniform float uScanSpeed;
  uniform float uPointSizeBase;
  uniform float uPixelRatio;

  varying float vCoreBoost;
  varying float vDepthTone;
  varying float vScanPulse;
  varying float vRimFade;
  varying float vAssembleFade;
  varying float vAssembleFlash;

  void main() {
    vec3 pos = position;
    float t = uTime;

    // Gentle per-cell 3D orbital floating modulated by persona dispersion & mic/voice energy
    float orbitAmp = (0.0022 + 0.0020 * uDispersion + 0.0025 * uMicLevel + 0.0020 * uGlowBoost + 0.006 * uBargeIn);
    float angle1 = t * (0.62 + 0.25 * uDispersion) + aPhase * 6.2831853;
    float angle2 = t * (0.48 + 0.20 * uDispersion) + aPhase * 12.5663706;
    pos.x += cos(angle1) * orbitAmp;
    pos.y += sin(angle2) * orbitAmp * 0.85;
    pos.z += sin(angle1 * 0.82 + aPhase * 3.14159) * orbitAmp;

    // Subtle chest breathing motion
    float breath = sin(t * 1.55) * 0.0045;
    float torsoMask = smoothstep(-0.35, 0.35, pos.y) * (1.0 - smoothstep(0.45, 0.78, pos.y));
    pos.z += breath * torsoMask;

    // Real-time lip-sync / lower-face jaw & mouth displacement driven by AnalyserNode
    if (aJawWeight > 0.001 || aMouthWeight > 0.001) {
      float jawDrop = uJawOpen * (0.055 * aJawWeight + 0.025 * aMouthWeight);
      float mouthForward = uJawOpen * (0.016 * aJawWeight + 0.018 * aMouthWeight);
      pos.y -= jawDrop;
      pos.z += mouthForward;
    }

    // Radial dispersion ripple on barge-in interruption or active listening
    float radialBurst = (uBargeIn * 0.045 + uMicLevel * 0.014) * sin(pos.y * 8.0 - t * 9.0 + aPhase * 4.0);
    pos.xz += normalize(pos.xz + vec2(0.0001)) * radialBurst;

    // Bottom-to-top particle assembly wave: particles erupt from bottom launch button
    // and stream upward layer-by-layer from boots -> legs -> torso -> shoulders -> helmet.
    float heightNorm = clamp((position.y + 1.12) / 2.27, 0.0, 1.0);
    float bandStart = heightNorm * 0.62;
    float particleProgress = smoothstep(bandStart, bandStart + 0.38, uAssemble);
    float invP = 1.0 - particleProgress;

    if (invP > 0.0005) {
      float theta = aPhase * 6.2831853 + invP * (5.4 + aPhase * 3.4);
      float originR = 0.04 + 0.22 * aPhase;
      vec3 launchOrigin = vec3(
        cos(theta) * originR,
        -1.95 - aPhase * 0.42,
        sin(theta) * originR
      );

      float arc = sin(particleProgress * 3.14159265);
      float swirlRadius = arc * (0.24 + 0.30 * aPhase);

      pos = mix(launchOrigin, pos, particleProgress);
      pos.x += cos(theta * 1.45 + t * 3.4) * swirlRadius;
      pos.z += sin(theta * 1.45 + t * 3.4) * swirlRadius;
      pos.y += arc * 0.10 * (aPhase - 0.5);
    }

    vAssembleFade = smoothstep(0.0, 0.12, particleProgress);
    vAssembleFlash = sin(particleProgress * 3.14159265) * 1.35;

    // Vertical holographic scan wave sweeping upward across the silhouette
    float scanY = fract(t * 0.24 * uScanSpeed) * 2.25 - 1.12;
    float scanBand = exp(-pow((pos.y - scanY) * 5.6, 2.0));
    float thinkWave = uThinking * (0.5 + 0.5 * sin(pos.y * 10.0 - t * 6.5));
    vScanPulse = scanBand * (0.48 + 0.42 * uGlowBoost + 0.50 * uMicLevel) + thinkWave * 0.32 + uBargeIn * 0.65;

    vec4 mvPosition = modelViewMatrix * vec4(pos, 1.0);
    float dist = max(1.15, -mvPosition.z);

    // Crisp half-size micro-dots calibrated for both desktop and high-DPI mobile screens
    float shimmer = 0.92 + 0.12 * sin(t * 2.4 + aPhase * 15.0);
    float sizeFactor = (0.76 + aSize * 0.34) * shimmer * (1.0 + uGlowBoost * 0.12 + uMicLevel * 0.10 + vScanPulse * 0.08 + vAssembleFlash * 0.18);
    float computedSize = uPointSizeBase * sizeFactor * uPixelRatio * (3.6 / dist);
    gl_PointSize = clamp(computedSize, 1.25, 3.3 * uPixelRatio);

    vCoreBoost = clamp(0.18 + uGlowBoost * 0.58 + uMicLevel * 0.45 + (aJawWeight + aMouthWeight) * uJawOpen * 0.45, 0.0, 1.35);
    vDepthTone = clamp((pos.z + 0.42) * 1.15, 0.0, 1.0);
    vRimFade = smoothstep(8.2, 2.0, dist) * clamp(aFade, 0.25, 1.0);

    gl_Position = projectionMatrix * mvPosition;
  }
`;

const AVATAR_FRAGMENT_SHADER = /* glsl */ `
  uniform vec3 uDeepColor;
  uniform vec3 uMidColor;
  uniform vec3 uCoreColor;
  uniform float uGlowBoost;

  varying float vCoreBoost;
  varying float vDepthTone;
  varying float vScanPulse;
  varying float vRimFade;
  varying float vAssembleFade;
  varying float vAssembleFlash;

  void main() {
    if (vAssembleFade < 0.01) discard;

    vec2 uv = gl_PointCoord - vec2(0.5);
    float r = length(uv) * 2.0;
    if (r > 1.0) discard;

    // Vivid, razor-crisp Gaussian core tuned specifically for half-size micro-dots
    float core = exp(-r * r * 5.2) * 1.55;
    float membrane = exp(-r * r * 2.1) * 0.62;
    float edgeSoft = smoothstep(1.0, 0.50, r);

    vec3 baseCol = mix(uDeepColor, uMidColor, clamp(vDepthTone * 0.78 + 0.22, 0.0, 1.0));
    vec3 col = mix(baseCol, uCoreColor, clamp(core * 0.48 + vScanPulse * 0.35 + vCoreBoost * 0.22 + vAssembleFlash * 0.55, 0.0, 1.0));

    float luminance = (core + membrane) * (0.98 + 0.26 * vCoreBoost + 0.38 * vScanPulse + vAssembleFlash * 0.65);
    float alpha = clamp(luminance * edgeSoft * vRimFade * vAssembleFade, 0.0, 0.98);

    if (alpha < 0.02) discard;
    gl_FragColor = vec4(col * (1.28 + 0.24 * uGlowBoost + 0.32 * vScanPulse + vAssembleFlash * 0.45), alpha);
  }
`;

const BG_VERTEX_SHADER = /* glsl */ `
  attribute float aPhase;
  attribute float aSize;
  attribute float aLuma;
  attribute vec3 aColor;

  uniform float uTime;
  uniform float uBgAssemble;
  uniform float uBgPointSize;
  uniform float uPixelRatio;
  uniform float uVoicePulse;

  varying float vLuma;
  varying float vTwinkle;
  varying float vEdgeFade;
  varying float vAssembleAlpha;
  varying vec3 vColor;

  void main() {
    vec3 pos = position;

    // Subtle upward materialization of the dim 3D CS2 courtyard behind the assembling hologram
    float hNorm = clamp((position.y + 2.3) / 4.6, 0.0, 1.0);
    float bgP = smoothstep(hNorm * 0.45, hNorm * 0.45 + 0.55, uBgAssemble);
    pos.y -= (1.0 - bgP) * 1.15;

    float t = uTime * 0.32;
    pos.x += cos(t + aPhase * 6.28318) * 0.0045;
    pos.y += sin(t * 0.85 + aPhase * 9.42477) * 0.0040;

    vec4 mvPosition = modelViewMatrix * vec4(pos, 1.0);
    float dist = max(1.8, -mvPosition.z);

    // Half-size wispy background micro-dots so character pops cleanly
    float sizeFactor = 0.72 + aSize * 0.32;
    float computedSize = uBgPointSize * sizeFactor * uPixelRatio * (3.8 / dist);
    gl_PointSize = clamp(computedSize, 0.85, 2.2 * uPixelRatio);

    vLuma = aLuma;
    vColor = aColor;
    vAssembleAlpha = bgP;
    vTwinkle = 0.88 + 0.12 * sin(uTime * 1.2 + aPhase * 12.0) + uVoicePulse * 0.12;

    float radial = length(pos.xy * vec2(0.24, 0.34));
    vEdgeFade = clamp(1.0 - smoothstep(0.75, 1.55, radial), 0.16, 1.0);

    gl_Position = projectionMatrix * mvPosition;
  }
`;

const BG_FRAGMENT_SHADER = /* glsl */ `
  uniform vec3 uBgTint;
  varying float vLuma;
  varying float vTwinkle;
  varying float vEdgeFade;
  varying float vAssembleAlpha;
  varying vec3 vColor;

  void main() {
    if (vAssembleAlpha < 0.01) discard;

    vec2 uv = gl_PointCoord - vec2(0.5);
    float r = length(uv) * 2.0;
    if (r > 1.0) discard;

    float core = exp(-r * r * 11.5) * 1.15;
    float halo = exp(-r * r * 3.6) * 0.28;
    float intensity = (core + halo) * (0.28 + 0.72 * vLuma) * vTwinkle * vEdgeFade;

    vec3 holoTone = mix(uBgTint * 0.48, vec3(0.42, 0.78, 0.94), clamp(vLuma * 0.65, 0.0, 1.0));
    vec3 col = mix(holoTone, vColor, 0.22);
    float alpha = clamp(intensity * 0.34 * vAssembleAlpha, 0.0, 0.36);

    if (alpha < 0.015) discard;
    gl_FragColor = vec4(col, alpha);
  }
`;

function detectSoftwareRenderer(renderer: THREE.WebGLRenderer): boolean {
  try {
    const gl = renderer.getContext();
    const debugExt = gl.getExtension('WEBGL_debug_renderer_info');
    if (!debugExt) return false;
    const rendererStr = String(gl.getParameter(debugExt.UNMASKED_RENDERER_WEBGL) || '');
    return /SwiftShader|llvmpipe|Software|Mesa OffScreen/i.test(rendererStr);
  } catch {
    return false;
  }
}

function buildAvatarGeometry(cloud: PointCloudData): THREE.BufferGeometry {
  const geom = new THREE.BufferGeometry();
  geom.setAttribute('position', new THREE.BufferAttribute(cloud.positions, 3));
  geom.setAttribute('aPhase', new THREE.BufferAttribute(cloud.seeds, 1));
  geom.setAttribute('aSize', new THREE.BufferAttribute(cloud.scales, 1));
  geom.setAttribute('aMouthWeight', new THREE.BufferAttribute(cloud.mouthWeights, 1));
  geom.setAttribute('aJawWeight', new THREE.BufferAttribute(cloud.jawWeights, 1));
  geom.setAttribute('aFade', new THREE.BufferAttribute(cloud.fades, 1));
  geom.computeBoundingSphere();
  return geom;
}

function buildBackgroundGeometry(cloud: BackgroundPointCloudData): THREE.BufferGeometry {
  const geom = new THREE.BufferGeometry();
  geom.setAttribute('position', new THREE.BufferAttribute(cloud.positions, 3));
  geom.setAttribute('aPhase', new THREE.BufferAttribute(cloud.seeds, 1));
  geom.setAttribute('aSize', new THREE.BufferAttribute(cloud.scales, 1));
  geom.setAttribute('aLuma', new THREE.BufferAttribute(cloud.intensities, 1));
  geom.setAttribute('aColor', new THREE.BufferAttribute(cloud.colors, 3));
  geom.computeBoundingSphere();
  return geom;
}

export function SoldierHologram({
  pointCloud,
  backgroundCloud,
  audioEngine,
  phase,
  visualMood,
  bargeInPulseNonce,
  modelMode,
  isOpen,
  onSoftwareGlDetected,
}: SoldierHologramProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);

  const phaseRef = useRef(phase);
  phaseRef.current = phase;

  const isOpenRef = useRef(isOpen);
  isOpenRef.current = isOpen;

  const moodRef = useRef(visualMood);
  moodRef.current = visualMood;

  const bargeInImpulseRef = useRef(0);
  const lastBargeInNonceRef = useRef(bargeInPulseNonce);
  if (bargeInPulseNonce !== lastBargeInNonceRef.current) {
    lastBargeInNonceRef.current = bargeInPulseNonce;
    bargeInImpulseRef.current = 1.0;
  }

  const audioEngineRef = useRef(audioEngine);
  audioEngineRef.current = audioEngine;

  const onSoftwareGlRef = useRef(onSoftwareGlDetected);
  onSoftwareGlRef.current = onSoftwareGlDetected;

  const avatarPointsRef = useRef<THREE.Points | null>(null);
  const bgPointsRef = useRef<THREE.Points | null>(null);
  const hasBgGeomRef = useRef<boolean>(false);
  const isFullBodyRef = useRef<boolean>(pointCloud.isFullBody);
  isFullBodyRef.current = pointCloud.isFullBody;

  const updateCameraAndPointScale = useRef<() => void>(() => {});

  // Mount Three.js WebGL scene ONCE
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color('#030a14');

    const width = Math.max(1, container.clientWidth);
    const height = Math.max(1, container.clientHeight);
    const camera = new THREE.PerspectiveCamera(34, width / height, 0.1, 40);

    const renderer = new THREE.WebGLRenderer({
      antialias: true,
      alpha: false,
      powerPreference: 'high-performance',
    });
    const isSoftware = detectSoftwareRenderer(renderer);
    onSoftwareGlRef.current?.(isSoftware);

    const maxDpr = isSoftware ? 1 : Math.min(window.devicePixelRatio || 1, 2);
    renderer.setPixelRatio(maxDpr);
    renderer.setSize(width, height, false);
    renderer.domElement.style.width = '100%';
    renderer.domElement.style.height = '100%';
    renderer.domElement.style.display = 'block';
    container.appendChild(renderer.domElement);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.06;
    controls.enablePan = false;
    controls.minDistance = 1.65;
    controls.maxDistance = 6.8;
    controls.minPolarAngle = Math.PI * 0.24;
    controls.maxPolarAngle = Math.PI * 0.72;

    let assembleLinear = isOpenRef.current ? 1.0 : 0.0;

    // Avatar Hologram Point Cloud (NO floor circles beneath feet)
    const avatarMat = new THREE.ShaderMaterial({
      vertexShader: AVATAR_VERTEX_SHADER,
      fragmentShader: AVATAR_FRAGMENT_SHADER,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      uniforms: {
        uTime: { value: 0 },
        uAssemble: { value: assembleLinear },
        uJawOpen: { value: 0 },
        uGlowBoost: { value: 0 },
        uMicLevel: { value: 0 },
        uThinking: { value: 0 },
        uBargeIn: { value: 0 },
        uDispersion: { value: moodRef.current.dispersion },
        uScanSpeed: { value: moodRef.current.scanSpeed },
        uPointSizeBase: { value: 2.0 },
        uPixelRatio: { value: maxDpr },
        uDeepColor: { value: new THREE.Color(...moodRef.current.deepColor) },
        uMidColor: { value: new THREE.Color(...moodRef.current.midColor) },
        uCoreColor: { value: new THREE.Color(...moodRef.current.coreColor) },
      },
    });

    const initialAvatarGeom = buildAvatarGeometry(pointCloud);
    const avatarPoints = new THREE.Points(initialAvatarGeom, avatarMat);
    avatarPoints.frustumCulled = false;
    avatarPoints.visible = assembleLinear > 0.002;
    scene.add(avatarPoints);
    avatarPointsRef.current = avatarPoints;

    // Dim 3D Projected Background Point Cloud (CS2 Courtyard or API background)
    const bgMat = new THREE.ShaderMaterial({
      vertexShader: BG_VERTEX_SHADER,
      fragmentShader: BG_FRAGMENT_SHADER,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      uniforms: {
        uTime: { value: 0 },
        uBgAssemble: { value: assembleLinear },
        uBgPointSize: { value: 1.5 },
        uPixelRatio: { value: maxDpr },
        uVoicePulse: { value: 0 },
        uBgTint: { value: new THREE.Color('#22a6cf') },
      },
    });

    const emptyBgGeom = new THREE.BufferGeometry();
    const bgPoints = new THREE.Points(emptyBgGeom, bgMat);
    bgPoints.frustumCulled = false;
    bgPoints.visible = false;
    bgPoints.position.set(0, 0.02, -1.65);
    scene.add(bgPoints);
    bgPointsRef.current = bgPoints;

    // Ultra-fine ambient spatial dust motes (half-size 0.0095)
    const dustCount = 220;
    const dustPositions = new Float32Array(dustCount * 3);
    for (let i = 0; i < dustCount; i++) {
      const theta = (i * 2.3999632) % (Math.PI * 2);
      const radius = 1.65 + ((i * 73) % 100) * 0.036;
      const y = (((i * 37) % 100) / 100 - 0.5) * 4.2;
      dustPositions[i * 3] = Math.cos(theta) * radius;
      dustPositions[i * 3 + 1] = y;
      dustPositions[i * 3 + 2] = Math.sin(theta) * radius - 0.8;
    }
    const dustGeom = new THREE.BufferGeometry();
    dustGeom.setAttribute('position', new THREE.BufferAttribute(dustPositions, 3));
    const dustMat = new THREE.PointsMaterial({
      color: '#5ec8e8',
      size: 0.0095,
      transparent: true,
      opacity: 0.20,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      sizeAttenuation: true,
    });
    const dustPoints = new THREE.Points(dustGeom, dustMat);
    scene.add(dustPoints);

    const applyResponsiveFraming = () => {
      const w = Math.max(1, container.clientWidth);
      const h = Math.max(1, container.clientHeight);
      const aspect = w / h;
      const isPortrait = aspect < 0.92;
      const fullBody = isFullBodyRef.current;

      camera.aspect = aspect;
      camera.updateProjectionMatrix();

      const dpr = isSoftware ? 1 : Math.min(window.devicePixelRatio || 1, 2);
      renderer.setPixelRatio(dpr);
      renderer.setSize(w, h, false);

      // Frame full-body or upper-body avatar cleanly above the minimal bottom chat capsule
      const targetY = fullBody ? (isPortrait ? -0.10 : -0.10) : isPortrait ? -0.04 : -0.02;
      const dist = fullBody
        ? isPortrait
          ? 4.95
          : 4.55
        : isPortrait
          ? 3.35
          : 2.95;

      controls.target.set(0, targetY, 0);
      camera.position.set(0, targetY + 0.08, dist);
      controls.update();

      // HALF-SIZE points across avatar/GLB & surrounding environment
      avatarMat.uniforms.uPixelRatio.value = dpr;
      avatarMat.uniforms.uPointSizeBase.value = fullBody
        ? isPortrait
          ? 1.85
          : 2.15
        : isPortrait
          ? 1.95
          : 2.25;

      bgMat.uniforms.uPixelRatio.value = dpr;
      bgMat.uniforms.uBgPointSize.value = isPortrait ? 1.4 : 1.6;
    };

    updateCameraAndPointScale.current = applyResponsiveFraming;
    applyResponsiveFraming();

    const resizeObserver = new ResizeObserver(() => {
      applyResponsiveFraming();
    });
    resizeObserver.observe(container);

    const targetDeep = new THREE.Color(...moodRef.current.deepColor);
    const targetMid = new THREE.Color(...moodRef.current.midColor);
    const targetCore = new THREE.Color(...moodRef.current.coreColor);

    const prefersReducedMotion =
      typeof window !== 'undefined' &&
      window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

    let rafId = 0;
    let timerId = 0;
    let disposed = false;
    let lastNow = performance.now();
    let elapsed = 0;
    let thinkingSmooth = 0;

    const stepFrame = () => {
      if (disposed) return;

      const now = performance.now();
      const dt = Math.min(0.1, Math.max(0.001, (now - lastNow) / 1000));
      lastNow = now;
      elapsed += prefersReducedMotion ? dt * 0.2 : dt;

      // Advance bottom-to-top particle assembly progress smoothly over 2.6s
      if (prefersReducedMotion) {
        assembleLinear = isOpenRef.current ? 1.0 : 0.0;
      } else {
        assembleLinear = advanceAssemblyProgress(assembleLinear, isOpenRef.current, dt, 2.6, 0.78);
      }

      const easedAssemble = isOpenRef.current
        ? easeInOutSine(assembleLinear)
        : easeOutCubic(assembleLinear);
      const bgAssembleLinear = Math.max(0, Math.min(1, (assembleLinear - 0.22) / 0.78));
      const easedBgAssemble = easeInOutSine(bgAssembleLinear);

      avatarPoints.visible = easedAssemble > 0.002;
      bgPoints.visible = hasBgGeomRef.current && easedBgAssemble > 0.002;
      controls.enabled = isOpenRef.current;

      const lip = audioEngineRef.current.sample(dt);
      const curPhase = phaseRef.current;
      const curMood = moodRef.current;

      targetDeep.setRGB(curMood.deepColor[0], curMood.deepColor[1], curMood.deepColor[2]);
      targetMid.setRGB(curMood.midColor[0], curMood.midColor[1], curMood.midColor[2]);
      targetCore.setRGB(curMood.coreColor[0], curMood.coreColor[1], curMood.coreColor[2]);

      const lerpAlpha = Math.min(1, dt * 4.5);
      (avatarMat.uniforms.uDeepColor.value as THREE.Color).lerp(targetDeep, lerpAlpha);
      (avatarMat.uniforms.uMidColor.value as THREE.Color).lerp(targetMid, lerpAlpha);
      (avatarMat.uniforms.uCoreColor.value as THREE.Color).lerp(targetCore, lerpAlpha);
      avatarMat.uniforms.uDispersion.value +=
        (curMood.dispersion - avatarMat.uniforms.uDispersion.value) * lerpAlpha;
      avatarMat.uniforms.uScanSpeed.value +=
        (curMood.scanSpeed - avatarMat.uniforms.uScanSpeed.value) * lerpAlpha;

      const wantThink = curPhase === 'thinking' ? 1 : 0;
      thinkingSmooth += (wantThink - thinkingSmooth) * Math.min(1, dt * 6);
      bargeInImpulseRef.current = Math.max(0, bargeInImpulseRef.current - dt * 2.4);

      const effectiveMic =
        curPhase === 'listening' || curPhase === 'barge_in'
          ? Math.max(lip.micLevel, 0.22 + 0.10 * Math.sin(elapsed * 5.2))
          : lip.micLevel;

      avatarMat.uniforms.uTime.value = elapsed;
      avatarMat.uniforms.uAssemble.value = easedAssemble;
      avatarMat.uniforms.uJawOpen.value = lip.jawOpen;
      avatarMat.uniforms.uGlowBoost.value = lip.glowBoost;
      avatarMat.uniforms.uMicLevel.value = effectiveMic;
      avatarMat.uniforms.uThinking.value = thinkingSmooth;
      avatarMat.uniforms.uBargeIn.value = bargeInImpulseRef.current;

      bgMat.uniforms.uTime.value = elapsed;
      bgMat.uniforms.uBgAssemble.value = easedBgAssemble;
      bgMat.uniforms.uVoicePulse.value = Math.max(lip.glowBoost, effectiveMic);
      (bgMat.uniforms.uBgTint.value as THREE.Color).lerp(targetDeep, lerpAlpha * 0.6);

      if (!prefersReducedMotion) {
        avatarPoints.rotation.y = Math.sin(elapsed * 0.34) * 0.14 * easedAssemble;
        dustPoints.rotation.y = elapsed * 0.015;
      }

      controls.update();
      renderer.render(scene, camera);

      if (isSoftware) {
        timerId = window.setTimeout(() => {
          rafId = window.requestAnimationFrame(stepFrame);
        }, 48);
      } else {
        rafId = window.requestAnimationFrame(stepFrame);
      }
    };

    rafId = window.requestAnimationFrame(stepFrame);

    return () => {
      disposed = true;
      window.cancelAnimationFrame(rafId);
      window.clearTimeout(timerId);
      resizeObserver.disconnect();
      controls.dispose();

      avatarPoints.geometry.dispose();
      avatarMat.dispose();
      bgPoints.geometry.dispose();
      bgMat.dispose();
      dustGeom.dispose();
      dustMat.dispose();
      renderer.dispose();

      if (renderer.domElement.parentNode === container) {
        container.removeChild(renderer.domElement);
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Swap avatar / API-loaded .GLB point-cloud geometry smoothly without rebuilding WebGLRenderer
  useEffect(() => {
    const pts = avatarPointsRef.current;
    if (!pts) return;
    const prevGeom = pts.geometry;
    pts.geometry = buildAvatarGeometry(pointCloud);
    prevGeom.dispose();
    isFullBodyRef.current = pointCloud.isFullBody;
    updateCameraAndPointScale.current();
  }, [pointCloud]);

  // Swap dim 3D background point-cloud geometry
  useEffect(() => {
    const bgPts = bgPointsRef.current;
    if (!bgPts) return;
    const prevGeom = bgPts.geometry;
    if (backgroundCloud && backgroundCloud.count > 0) {
      bgPts.geometry = buildBackgroundGeometry(backgroundCloud);
      hasBgGeomRef.current = true;
    } else {
      bgPts.geometry = new THREE.BufferGeometry();
      hasBgGeomRef.current = false;
      bgPts.visible = false;
    }
    prevGeom.dispose();
  }, [backgroundCloud]);

  return (
    <div
      ref={containerRef}
      data-testid="hologram-stage"
      data-model-mode={modelMode}
      data-open={isOpen ? 'true' : 'false'}
      data-phase={phase}
      aria-label="Interactive 3D holographic point-cloud stage"
      className="fixed inset-0 z-0 h-full w-full touch-none select-none"
    />
  );
}
