<script setup lang="ts">
import ExpandPanel from '../components/ExpandPanel.vue'
</script>

<template>
  <div class="panel-root">
    <ExpandPanel />
  </div>
</template>

<style scoped>
.panel-root {
  width: 100%;
  height: 100%;
  display: flex;
  align-items: flex-end;
  justify-content: flex-end;
  padding: 8px;
}
</style>
