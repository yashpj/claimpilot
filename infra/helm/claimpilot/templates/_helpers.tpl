{{- define "cp.image" -}}
{{- $tag := required "set image.tag (git SHA); never deploy :latest" .root.Values.image.tag -}}
{{ .root.Values.image.registry }}/claimpilot-{{ .name }}:{{ $tag }}
{{- end -}}

{{- define "cp.labels" -}}
app.kubernetes.io/name: {{ .name }}
app.kubernetes.io/part-of: claimpilot
app.kubernetes.io/instance: {{ .root.Release.Name }}
{{- end -}}

{{- define "cp.selector" -}}
app.kubernetes.io/name: {{ .name }}
app.kubernetes.io/instance: {{ .root.Release.Name }}
{{- end -}}

{{/* Pod-level hardening shared by every workload. */}}
{{- define "cp.podSecurity" -}}
securityContext:
  runAsNonRoot: true
  seccompProfile: { type: RuntimeDefault }
{{- end -}}

{{- define "cp.containerSecurity" -}}
securityContext:
  allowPrivilegeEscalation: false
  readOnlyRootFilesystem: true
  capabilities: { drop: [ALL] }
{{- end -}}
