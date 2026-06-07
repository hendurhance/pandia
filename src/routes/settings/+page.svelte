<script lang="ts">
	import SettingsView from '$lib/settings/SettingsView.svelte';

	function close() {
		window.location.href = '/';
	}
</script>

<SettingsView onClose={close} />
