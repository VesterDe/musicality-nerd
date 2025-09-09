<script lang="ts">
	import { sessionStore } from '$lib/stores/sessionStore.svelte';
	import AnnotationModePanel from '../AnnotationModePanel.svelte';
</script>

<div class="space-y-3">
	<AnnotationModePanel
		isAnnotationMode={sessionStore.isAnnotationMode}
		onToggle={() => sessionStore.toggleAnnotationMode()}
		annotationTemplate={sessionStore.annotationTemplate}
		onTemplateChange={(template) => sessionStore.updateAnnotationTemplate(template)}
		annotationCount={sessionStore.annotationCounter}
		horizontal={false}
	/>
	
	<div class="text-xs text-gray-400 space-y-1 pt-2 border-t border-gray-700">
		<p><kbd class="bg-gray-700 px-1 rounded">M</kbd> Toggle annotation mode</p>
		<p><kbd class="bg-gray-700 px-1 rounded">A</kbd> Create annotation (hold while playing)</p>
	</div>
</div>