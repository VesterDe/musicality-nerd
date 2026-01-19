<script lang="ts">
	import { sessionStore } from '$lib/stores/sessionStore.svelte';
	import AnnotationModePanel from '../AnnotationModePanel.svelte';
	import AnnotationGroupList from './AnnotationGroupList.svelte';
</script>

<div class="space-y-3">
	<AnnotationModePanel
		isAnnotationMode={sessionStore.isAnnotationMode}
		onToggle={() => sessionStore.toggleAnnotationMode()}
		annotationTemplate={sessionStore.annotationTemplate}
		onTemplateChange={(template) => sessionStore.updateAnnotationTemplate(template)}
		annotationCount={sessionStore.getNextCounterForColor(sessionStore.annotationTemplate.color)}
		horizontal={false}
	/>

	<div class="text-xs text-gray-400 space-y-1 pt-2 border-t border-gray-700">
		<p><kbd class="bg-gray-700 px-1 rounded">M</kbd> Toggle annotation mode</p>
		<p><kbd class="bg-gray-700 px-1 rounded">A</kbd> Create annotation (hold while playing)</p>
	</div>

	<AnnotationGroupList />

	{#if sessionStore.currentSession?.annotations && sessionStore.currentSession.annotations.length > 0}
		<div class="pt-3">
			<button
				class="bg-red-600 hover:bg-red-700 text-white px-3 py-1.5 rounded text-xs transition-colors"
				title="Clear all annotations"
				onclick={async () => {
					if (confirm('Are you sure you want to clear all annotations?')) {
						await sessionStore.clearAllAnnotations();
					}
				}}
			>
				Clear All ({sessionStore.currentSession.annotations.length})
			</button>
		</div>
	{/if}
</div>