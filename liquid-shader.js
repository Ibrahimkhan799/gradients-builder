// The material is a closed volume, not a color ramp painted onto a height map.
// Entry/exit normals bend a studio light field; wavelength offsets and a thin
// film create the nested spectral contours seen in the reference photographs.
export const FRAGMENT_SHADER = `
#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif
precision mediump int;

uniform vec2 u_resolution;
uniform float u_time;
uniform int u_shape;
uniform vec3 u_palette[4];
uniform vec4 u_seed;
uniform float u_flow;
uniform float u_intensity;
uniform float u_distortion;
uniform float u_scale;
uniform float u_softness;
uniform float u_grain;
uniform float u_rotation;
uniform float u_dispersion;
uniform float u_thickness;
uniform float u_exposure;

const float PI = 3.14159265359;

mat2 turn(float a) {
  float s = sin(a), c = cos(a);
  return mat2(c, -s, s, c);
}

float smoothUnion(float a, float b, float k) {
  float h = max(k - abs(a - b), 0.0) / k;
  return min(a, b) - h * h * k * 0.25;
}

float torus(vec3 p, vec2 radii, vec2 crossSection) {
  vec2 q = vec2(length(p.xy) - radii.x, p.z) / crossSection;
  return (length(q) - radii.y) * min(crossSection.x, crossSection.y);
}

float scene(vec3 p) {
  float t = u_time;
  // Low-frequency, volume-preserving-looking bends keep the silhouettes broad.
  // The conservative march step accounts for this non-distance-preserving warp.
  float bend = 0.12 + 0.48 * u_flow;
  p.x += bend * sin(0.82 * p.y + 0.25 * p.z + u_seed.x + 0.2 * t);
  p.y += bend * 0.60 * sin(0.72 * p.x - 0.30 * p.z + u_seed.y - 0.1 * t);
  p.z += (0.10 + 0.32 * u_distortion) *
    sin(1.10 * p.x + 0.68 * p.y + u_seed.z + 0.1 * t);

  float tilt = 0.14 * sin(u_seed.y);
  float ripple = 0.018 * u_distortion * sin(3.8 * p.y + 2.1 * p.x + u_seed.w);
  if (u_shape == 2) {
    vec3 q = p;
    q.xy *= turn(0.15 * sin(u_seed.z));
    q.yz *= turn(0.48);
    float angle = atan(q.y, q.x);
    float petals = 0.16 * sin(3.0 * angle + u_seed.x + 0.1 * t);
    return torus(q, vec2(1.34 + petals, 0.62), vec2(1.0, 0.74)) + ripple;
  }

  vec3 a = p - vec3(-0.55 + 0.18 * sin(u_seed.z), 3.55, -0.16);
  vec3 b = p - vec3(0.64 + 0.20 * sin(u_seed.w), -3.85, 0.26);
  a.xy *= turn(-0.19 + tilt);
  b.xy *= turn(0.16 - tilt);
  a.yz *= turn(0.25 + 0.14 * sin(u_seed.x));
  b.yz *= turn(-0.28 + 0.10 * sin(u_seed.w));
  a.x *= 0.88;
  b.x *= 0.91;
  // An asymmetric rising crest breaks the circular tube silhouette into the
  // stretched, pinched meniscus of the lower liquid form in the references.
  float crest = exp(-pow((b.x + 1.05) * 1.05, 2.0));
  b.y -= (u_shape == 1 ? 0.40 : 0.90) * crest;
  b.z += 0.16 * u_distortion * crest;

  float radius = u_shape == 1 ? 0.48 : 0.88;
  vec2 section = u_shape == 1 ? vec2(1.40, 0.48) : vec2(1.05, 0.78);
  float upper = torus(a, vec2(2.35, radius), section);
  float lower = torus(b, vec2(2.28, radius * 1.06), section);
  return smoothUnion(upper, lower, 0.22 + 0.30 * u_flow) + ripple;
}

vec3 normalAt(vec3 p, float epsilon) {
  vec2 e = vec2(epsilon, -epsilon);
  return normalize(e.xyy * scene(p + e.xyy) +
                   e.yyx * scene(p + e.yyx) +
                   e.yxy * scene(p + e.yxy) +
                   e.xxx * scene(p + e.xxx));
}

float intersect(vec3 origin, vec3 direction) {
  float distance = 0.0;
  for (int i = 0; i < 88; i++) {
    float d = scene(origin + direction * distance);
    if (d < 0.0010 || distance > 15.0) break;
    distance += max(d * 0.65, 0.0006);
  }
  return distance;
}

float gaussian(float x, float width) {
  float v = x / width;
  return exp(-v * v);
}

vec3 tint(vec3 color, vec3 paletteColor) {
  // Hue remains editable without letting a pastel swatch flatten the spectrum.
  float peak = max(paletteColor.r, max(paletteColor.g, paletteColor.b));
  vec3 hue = paletteColor / max(peak, 0.001);
  return color * mix(vec3(1.0), 0.04 + hue * 1.15, 0.60) * sqrt(peak);
}

vec3 spectralLine(float x, float width, float spread) {
  vec3 offset = vec3(0.86, 0.10, -0.72) * spread;
  vec3 v = (vec3(x) - offset) / width;
  return exp(-v * v) * vec3(1.0, 0.80, 1.0);
}

vec3 environment(vec3 ray, float dispersion, float blur) {
  // A dark photographic studio with curved strip lights, not colored panels.
  // Separated wavelengths produce warm/green/cyan/blue fringes around each
  // reflected light, even when the underlying glass has no body pigmentation.
  // Cartesian directions avoid a longitude seam in reflected/refracted rays.
  float key = ray.y + 0.24 * ray.x - 0.22;
  float envelope = 0.48 + 0.52 * max(0.0, dot(ray, vec3(0.32, 0.2, 0.926)));
  float spread = 0.105 * dispersion;
  float width = 0.042 + blur * 0.12;
  vec3 light = spectralLine(key, width, spread) * 2.2 * envelope;
  light += spectralLine(key - 0.18, width * 0.25, spread * 0.24) * 0.95 * envelope;
  light += spectralLine(key + 0.25, width * 0.20, -spread * 0.19) * 0.65 * envelope;
  light += spectralLine(key + 0.32, width * 0.13, spread * 0.11) * 0.28 * envelope;
  light = tint(light, u_palette[0]);

  float rim = ray.x * 0.96 + ray.z * 0.25 + 0.22 * ray.y - 0.18;
  float side = smoothstep(-0.3, 0.35, ray.x - ray.z * 0.25);
  vec3 warm = spectralLine(rim, 0.063 + blur * 0.12, spread * 1.20);
  light += tint(warm, u_palette[3]) * 1.8 * side;
  light += tint(spectralLine(rim + 0.26, 0.014 + blur * 0.03, spread * 0.18), u_palette[1]) * 0.5 * side;

  float back = ray.y - 0.17 * ray.z + 0.62;
  light += tint(spectralLine(back, 0.033 + blur * 0.09, -spread * 0.70), u_palette[2]) * 0.65;

  // A broad, dim reflection gives the glass volume without lifting the blacks.
  light += u_palette[1] * gaussian(key + 0.08, 0.24) * 0.008;
  light += u_palette[2] * gaussian(rim - 0.15, 0.33) * 0.006 * side;
  float glint = gaussian(key - 0.035, 0.005 + blur * 0.016) * gaussian(ray.x + 0.55, 0.10);
  light += vec3(1.0, 0.94, 0.82) * glint * 4.0;
  return light;
}

vec3 filmReflectance(float cosine, float thickness) {
  // Three representative wavelengths approximate angle-dependent thin-film
  // interference. Dispersion and interference are separate material effects.
  float opticalPath = 2.0 * thickness * sqrt(max(0.0, 1.48 * 1.48 - 1.0 + cosine * cosine));
  vec3 phase = 2.0 * PI * opticalPath / vec3(0.650, 0.510, 0.435);
  vec3 interference = 0.5 + 0.5 * cos(phase);
  return 0.08 + 0.92 * pow(interference, vec3(2.0));
}

vec3 glass(vec3 p, vec3 direction, vec3 normal) {
  float facing = clamp(dot(-direction, normal), 0.0, 1.0);
  float fresnel = 0.045 + 0.955 * pow(1.0 - facing, 5.0);
  float roughness = 0.025 + u_softness * u_softness;
  float dispersion = u_dispersion * (0.4 + 0.6 * u_intensity);
  float filmDepth = 0.28 + 0.53 * u_thickness +
    0.05 * sin(p.x * 0.7 + p.y * 0.9 + u_seed.w);
  vec3 film = filmReflectance(facing, filmDepth);
  vec3 reflected = reflect(direction, normal);
  vec3 coating = mix(vec3(1.0), 0.25 + 1.6 * film, u_intensity * 0.66);
  vec3 reflection = environment(reflected, dispersion, roughness) * coating;

  // March inside the actual closed surface to find the exit interface. This
  // creates lensing and nested highlights rather than a second painted layer.
  float ior = mix(1.16, 1.72, u_thickness);
  vec3 inside = refract(direction, normal, 1.0 / ior);
  vec3 start = p + inside * 0.015;
  float travel = 0.02;
  for (int i = 0; i < 44; i++) {
    float d = -scene(start + inside * travel);
    if (d < 0.0004 || travel > 5.0) break;
    travel += max(0.0003, d * 0.70);
  }
  // Refine the interface rather than shading quantized sphere-tracing steps.
  for (int i = 0; i < 3; i++) {
    vec3 q = start + inside * travel;
    float d = scene(q);
    float slope = (scene(q + inside * 0.003) - d) / 0.003;
    travel -= clamp(d / max(slope, 0.08), -0.025, 0.025);
  }
  vec3 exitPoint = start + inside * travel;
  vec3 exitNormal = -normalAt(exitPoint, 0.004);
  vec3 red = refract(inside, exitNormal, ior - dispersion * 0.018);
  vec3 green = refract(inside, exitNormal, ior);
  vec3 blue = refract(inside, exitNormal, ior + dispersion * 0.025);
  vec3 internalReflection = reflect(inside, exitNormal);
  if (dot(red, red) < 0.1) red = internalReflection;
  if (dot(green, green) < 0.1) green = internalReflection;
  if (dot(blue, blue) < 0.1) blue = internalReflection;
  vec3 transmission = vec3(
    environment(red, dispersion, roughness * 1.4).r,
    environment(green, dispersion, roughness * 1.4).g,
    environment(blue, dispersion, roughness * 1.4).b);
  vec3 eta = vec3(ior) + dispersion * vec3(-0.018, 0.0, 0.025);
  float ci = clamp(dot(-inside, exitNormal), 0.0, 1.0);
  vec3 ct = sqrt(max(vec3(0.0), 1.0 - eta * eta * (1.0 - ci * ci)));
  vec3 rs = (eta * ci - ct) / max(eta * ci + ct, vec3(0.0001));
  vec3 rp = (ci - eta * ct) / max(ci + eta * ct, vec3(0.0001));
  vec3 exitFresnel = clamp(0.5 * (rs * rs + rp * rp), 0.0, 1.0);
  vec3 absorption = exp(-travel * (0.28 + u_thickness * 0.28) * vec3(0.92, 0.65, 0.44));
  vec3 internalLight = environment(internalReflection, dispersion * 0.8, roughness * 1.8);
  // Fresnel smoothly suppresses transmission at the critical angle. Replacing
  // failed refractions abruptly would leave triangular patches in the glass.
  transmission = mix(transmission, internalLight, exitFresnel) * absorption;
  vec3 color = reflection * (0.42 + fresnel * 1.6) +
    transmission * (1.0 - fresnel) * 0.22;
  return color;
}

float hash(vec2 p) {
  vec3 q = fract(vec3(p.xyx) * 0.1031);
  q += dot(q, q.yzx + 33.33);
  return fract((q.x + q.y) * q.z);
}

vec3 tonemap(vec3 c) {
  float peak = max(c.r, max(c.g, c.b));
  float mapped = (peak * (2.51 * peak + 0.03)) /
    (peak * (2.43 * peak + 0.59) + 0.14);
  return c * (clamp(mapped, 0.0, 1.0) / max(peak, 0.0001));
}

void main() {
  vec2 screen = (2.0 * gl_FragCoord.xy - u_resolution) / u_resolution.y;
  vec2 uv = turn(u_rotation) * screen;
  float zoom = mix(1.13, 0.43, u_scale);
  vec3 origin = vec3(0.0, 0.0, 7.2);
  vec3 direction = normalize(vec3(uv * zoom, -2.4));
  float distance = intersect(origin, direction);
  vec3 color = vec3(0.0);
  if (distance < 15.0) {
    vec3 p = origin + direction * distance;
    if (scene(p) < 0.012) {
      for (int i = 0; i < 3; i++) {
        float d = scene(p);
        float slope = (scene(p + direction * 0.003) - d) / 0.003;
        distance -= clamp(d / min(slope, -0.08), -0.02, 0.02);
        p = origin + direction * distance;
      }
      vec3 normal = normalAt(p, 0.004);
      color = glass(p, direction, normal);
    }
  }
  color *= exp2((u_exposure - 0.5) * 4.0);
  float luminance = dot(color, vec3(0.2126, 0.7152, 0.0722));
  color = mix(vec3(luminance), color, min(1.0, u_intensity * 1.25));
  color = pow(tonemap(max(color, 0.0)), vec3(1.0 / 2.2));
  // Grain follows exposure, leaving the studio background truly black.
  float grain = (hash(gl_FragCoord.xy + u_seed.xy * 19.0) - 0.5) * u_grain * 0.045;
  color += grain * smoothstep(0.0, 0.12, max(color.r, max(color.g, color.b)));
  gl_FragColor = vec4(clamp(color, 0.0, 1.0), 1.0);
}
`;

// Edge-aware antialiasing and a restrained photographic highlight halo are
// shared by the live preview and PNG export; no reference image is sampled.
export const FINISH_SHADER = `
#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif
uniform sampler2D u_image;
uniform vec2 u_resolution;

float luminance(vec3 color) {
  return dot(color, vec3(0.299, 0.587, 0.114));
}
vec3 highlight(vec3 color) {
  float peak = max(color.r, max(color.g, color.b));
  return color * smoothstep(0.60, 0.95, peak);
}
void main() {
  vec2 pixel = 1.0 / u_resolution;
  vec2 uv = gl_FragCoord.xy * pixel;
  vec3 center = texture2D(u_image, uv).rgb;
  float nw = luminance(texture2D(u_image, uv + vec2(-1.0, 1.0) * pixel).rgb);
  float ne = luminance(texture2D(u_image, uv + vec2(1.0, 1.0) * pixel).rgb);
  float sw = luminance(texture2D(u_image, uv + vec2(-1.0, -1.0) * pixel).rgb);
  float se = luminance(texture2D(u_image, uv + vec2(1.0, -1.0) * pixel).rgb);
  float middle = luminance(center);
  float low = min(middle, min(min(nw, ne), min(sw, se)));
  float high = max(middle, max(max(nw, ne), max(sw, se)));
  vec2 direction = vec2(-((nw + ne) - (sw + se)), (nw + sw) - (ne + se));
  float reduce = max((nw + ne + sw + se) * 0.03125, 0.0078125);
  direction = clamp(direction / (min(abs(direction.x), abs(direction.y)) + reduce), -6.0, 6.0) * pixel;
  vec3 a = 0.5 * (texture2D(u_image, uv - direction / 6.0).rgb + texture2D(u_image, uv + direction / 6.0).rgb);
  vec3 b = a * 0.5 + 0.25 * (texture2D(u_image, uv - direction * 0.5).rgb + texture2D(u_image, uv + direction * 0.5).rgb);
  float lb = luminance(b);
  vec3 color = (lb < low || lb > high) ? a : b;
  color = mix(center, color, smoothstep(0.025, 0.10, high - low));

  vec2 radius = pixel * max(1.5, u_resolution.y * 0.003);
  vec3 halo = highlight(texture2D(u_image, uv + vec2(radius.x, 0.0)).rgb);
  halo += highlight(texture2D(u_image, uv - vec2(radius.x, 0.0)).rgb);
  halo += highlight(texture2D(u_image, uv + vec2(0.0, radius.y)).rgb);
  halo += highlight(texture2D(u_image, uv - vec2(0.0, radius.y)).rgb);
  halo += highlight(texture2D(u_image, uv + radius * 0.707).rgb);
  halo += highlight(texture2D(u_image, uv - radius * 0.707).rgb);
  halo += highlight(texture2D(u_image, uv + vec2(radius.x, -radius.y) * 0.707).rgb);
  halo += highlight(texture2D(u_image, uv + vec2(-radius.x, radius.y) * 0.707).rgb);
  color += halo * 0.010;
  gl_FragColor = vec4(clamp(color, 0.0, 1.0), 1.0);
}
`;
