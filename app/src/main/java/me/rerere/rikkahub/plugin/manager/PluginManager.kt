package me.rerere.rikkahub.plugin.manager
 
import android.content.Context
import android.net.Uri
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonElement
import me.rerere.rikkahub.data.service.DailySummaryService
import me.rerere.rikkahub.plugin.loader.PluginLoader
import me.rerere.rikkahub.plugin.model.PluginInfo
import me.rerere.rikkahub.plugin.repository.PluginRepository
import me.rerere.rikkahub.plugin.scanner.PluginScanner
import java.io.File
 
/**
 * 插件管理器
 * 统一管理插件的生命周期
 */
class PluginManager(
    private val context: Context,
    private val scanner: PluginScanner,
    private val loader: PluginLoader,
    private val repository: PluginRepository
) {
    private val json = Json {
        ignoreUnknownKeys = true
        isLenient = true
    }
 
    private val _plugins = MutableStateFlow<List<PluginInfo>>(emptyList())
    val plugins: StateFlow<List<PluginInfo>> = _plugins.asStateFlow()
 
    private val _isLoading = MutableStateFlow(false)
    val isLoading: StateFlow<Boolean> = _isLoading.asStateFlow()
 
    init {
        CoroutineScope(Dispatchers.IO).launch {
            refreshPlugins()
        }
    }
 
    suspend fun refreshPlugins() {
        _isLoading.value = true
        try {
            val scannedPlugins = scanner.scanPlugins()
            val pluginsWithConfig = scannedPlugins.map { plugin ->
                val savedConfig = repository.getPluginConfig(plugin.manifest.id)
                val isEnabled = repository.isPluginEnabled(plugin.manifest.id)
                plugin.copy(config = savedConfig, isEnabled = isEnabled)
            }
            _plugins.value = pluginsWithConfig
            pluginsWithConfig.filter { it.isEnabled }.forEach { plugin ->
                if (loader.getLoadedPlugin(plugin.manifest.id) == null) {
                    loadPlugin(plugin)
                }
            }
            DailySummaryService.rescheduleIfEnabled(context)
        } finally {
            _isLoading.value = false
        }
    }
 
    private suspend fun loadPlugin(plugin: PluginInfo) {
        loader.loadPlugin(plugin).fold(
            onSuccess = { },
            onFailure = { error ->
                updatePluginState(plugin.manifest.id) {
                    it.copy(isEnabled = false, loadError = error.message)
                }
            }
        )
    }
 
    suspend fun importPlugin(uri: Uri): Result<PluginInfo> {
        return try {
            val result = scanner.importFromZip(uri)
            result.fold(
                onSuccess = { pluginInfo ->
                    repository.savePlugin(pluginInfo)
                    loadPlugin(pluginInfo)
                    refreshPlugins()
                    Result.success(pluginInfo)
                },
                onFailure = { error -> Result.failure(error) }
            )
        } catch (e: Exception) {
            Result.failure(e)
        }
    }
 
    suspend fun deletePlugin(pluginId: String): Boolean {
        return try {
            loader.unloadPlugin(pluginId)
            val deleted = scanner.deletePlugin(pluginId)
            repository.removePlugin(pluginId)
            refreshPlugins()
            deleted
        } catch (e: Exception) {
            false
        }
    }
 
    suspend fun togglePlugin(pluginId: String, enabled: Boolean) {
        val plugin = _plugins.value.find { it.manifest.id == pluginId } ?: return
        if (enabled) {
            loadPlugin(plugin.copy(isEnabled = true))
        } else {
            loader.unloadPlugin(pluginId)
        }
        repository.setPluginEnabled(pluginId, enabled)
        updatePluginState(pluginId) { it.copy(isEnabled = enabled) }
        DailySummaryService.rescheduleIfEnabled(context)
    }
 
    suspend fun updatePluginConfig(pluginId: String, config: Map<String, JsonElement>) {
        repository.savePluginConfig(pluginId, config)
        updatePluginState(pluginId) { it.copy(config = config) }
        val plugin = _plugins.value.find { it.manifest.id == pluginId }
        if (plugin?.isEnabled == true) {
            loader.unloadPlugin(pluginId)
            loadPlugin(plugin.copy(config = config))
        }
    }
 
    suspend fun getPluginConfig(pluginId: String): Map<String, JsonElement> {
        return repository.getPluginConfig(pluginId)
    }
 
    fun getPluginsDirectory(): File = scanner.pluginsDir
 
    fun getPlugin(pluginId: String): PluginInfo? = _plugins.value.find { it.manifest.id == pluginId }
 
    suspend fun reloadAllPlugins() {
        loader.unloadAll()
        refreshPlugins()
    }
 
    /**
     * 调用插件工具函数（代理到 PluginLoader）
     * 供声明式 UI 的 call_js_function action 使用
     */
    suspend fun callTool(pluginId: String, toolName: String, params: JsonElement): Result<JsonElement> {
        return loader.callTool(pluginId, toolName, params)
    }
 
    private fun updatePluginState(pluginId: String, transform: (PluginInfo) -> PluginInfo) {
        _plugins.value = _plugins.value.map { plugin ->
            if (plugin.manifest.id == pluginId) transform(plugin) else plugin
        }
    }
}
 