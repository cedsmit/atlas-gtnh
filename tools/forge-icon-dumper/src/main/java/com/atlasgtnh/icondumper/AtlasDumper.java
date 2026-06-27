package com.atlasgtnh.icondumper;

import cpw.mods.fml.common.Loader;
import cpw.mods.fml.common.ModContainer;
import cpw.mods.fml.common.Mod;
import cpw.mods.fml.common.Mod.EventHandler;
import cpw.mods.fml.common.event.FMLPreInitializationEvent;
import cpw.mods.fml.common.eventhandler.SubscribeEvent;
import cpw.mods.fml.common.registry.FMLControlledNamespacedRegistry;
import cpw.mods.fml.common.registry.GameData;
import cpw.mods.fml.common.registry.GameRegistry;
import net.minecraftforge.client.event.TextureStitchEvent;
import net.minecraftforge.common.MinecraftForge;

import java.io.File;
import java.io.FileWriter;
import java.io.IOException;
import java.lang.reflect.Method;
import java.text.SimpleDateFormat;
import java.util.*;

/**
 * Atlas GTNH — Icon Dumper Mod
 *
 * Intercepts the post-texture-stitch event (fires after all registerBlockIcons()
 * calls complete) and calls block.getIcon(side, meta) via reflection for every
 * registered block × meta 0-15 × side 0-5.
 *
 * Uses reflection exclusively for vanilla MC class calls so the mod compiles
 * against only the Forge universal JAR without needing a deobfuscated MC JAR.
 * At runtime Forge's LaunchClassLoader deobfuscates vanilla classes to MCP names,
 * so reflection lookups by MCP name ("getIcon", "getIconName", etc.) succeed.
 *
 * Output: {gameDir}/config/atlas/icon_dump.json
 * Format: atlas-gtnh-icon-dump-v1
 */
@Mod(
    modid   = AtlasDumper.MOD_ID,
    name    = "Atlas Icon Dumper",
    version = AtlasDumper.VERSION,
    acceptedMinecraftVersions = "[1.7.10]"
)
public class AtlasDumper {

    public static final String MOD_ID  = "atlas_dumper";
    public static final String VERSION = "1.0.0";

    private File gameDir;
    // Guard: TextureStitchEvent.Post fires twice (blocks atlas, then items atlas).
    // We dump on the first fire (blocks atlas is always stitched first).
    private boolean dumped = false;

    // Resolved once on first dump; cached for the life of the process.
    private Method getIconMethod     = null;  // Block.getIcon(int, int) → IIcon
    private Method getIconNameMethod = null;  // IIcon.getIconName() → String
    private Method getNameMethod     = null;  // Registry.getNameForObject(Object) → String

    @EventHandler
    public void preInit(FMLPreInitializationEvent event) {
        this.gameDir = event.getModConfigurationDirectory().getParentFile();
        MinecraftForge.EVENT_BUS.register(this);
        System.out.println("[AtlasDumper] Registered — will dump icons after blocks texture stitch.");
    }

    @SubscribeEvent
    public void onTextureStitchPost(TextureStitchEvent.Post event) {
        if (dumped) return;
        dumped = true;
        System.out.println("[AtlasDumper] Texture atlas stitched — starting icon dump...");
        dumpIcons();
    }

    @SuppressWarnings({"unchecked", "rawtypes"})
    private void dumpIcons() {
        // ── Resolve reflection handles ────────────────────────────────────────
        // Forge's runtime deobfuscation maps vanilla class names to their MCP
        // package (net.minecraft.block.Block) but keeps method names at the SRG
        // level (func_149691_a), NOT the human-readable MCP name (getIcon).
        // We try both so the mod works whether or not MCP names are applied.
        try {
            Class<?> blockClass = Class.forName("net.minecraft.block.Block");
            for (String name : new String[]{"getIcon", "func_149691_a"}) {
                try { getIconMethod = blockClass.getMethod(name, int.class, int.class); break; }
                catch (NoSuchMethodException ignored) {}
            }
            if (getIconMethod == null) throw new NoSuchMethodException("getIcon / func_149691_a not found on Block");

            Class<?> iIconClass = getIconMethod.getReturnType();
            for (String name : new String[]{"getIconName", "func_94215_i", "func_110472_a"}) {
                try { getIconNameMethod = iIconClass.getMethod(name); break; }
                catch (NoSuchMethodException ignored) {}
            }
            if (getIconNameMethod == null) throw new NoSuchMethodException("getIconName / func_94215_i not found on IIcon");
        } catch (Exception e) {
            System.err.println("[AtlasDumper] FATAL: could not resolve Block.getIcon / IIcon.getIconName via reflection: " + e);
            return;
        }

        // ── Collect data ──────────────────────────────────────────────────────
        Map<String, Map<String, Map<String, String>>> blocksMap = new LinkedHashMap<>();
        int totalBlocks     = 0;   // blocks with a resolved registry name
        int resolvedBlocks  = 0;   // blocks that produced at least one icon
        int skippedNoName   = 0;   // registry entries with no resolvable name
        int errorCount      = 0;
        List<String> errorSamples = new ArrayList<>();
        List<String> noIconNames  = new ArrayList<>();  // named but zero icons (full list)

        // Raw registry — generics erased at runtime, elements are Block at runtime.
        FMLControlledNamespacedRegistry blockReg = GameData.getBlockRegistry();

        // Resolve getNameForObject — try MCP name, SRG name, then scan by signature.
        // At runtime this is on the vanilla RegistryNamespaced superclass; its
        // name depends on how far Forge deobfuscates (SRG vs MCP).
        if (getNameMethod == null) {
            for (String name : new String[]{"getNameForObject", "func_148741_d"}) {
                try {
                    getNameMethod = blockReg.getClass().getMethod(name, Object.class);
                    break;
                } catch (NoSuchMethodException ignored) {}
            }
        }
        // Last resort: scan for a method that returns String and takes one Object
        if (getNameMethod == null) {
            for (Method m : blockReg.getClass().getMethods()) {
                if (m.getReturnType() == String.class &&
                    m.getParameterCount() == 1 &&
                    m.getParameterTypes()[0] == Object.class &&
                    !java.lang.reflect.Modifier.isStatic(m.getModifiers())) {
                    getNameMethod = m;
                    break;
                }
            }
        }

        // Build the full block set.  The registry iterator can silently miss
        // blocks in some Forge/GTNH builds (observed: ProjectRed's blocks never
        // appear despite the mod being loaded).  We union the iterator with a
        // direct id-scan via Block.getBlockById, which backstops any iterator
        // gap and catches every block reachable by ID.
        Set<Object> blockSet = Collections.newSetFromMap(new IdentityHashMap<Object, Boolean>());
        Iterator<?> iter = blockReg.iterator();
        while (iter.hasNext()) {
            Object b = iter.next();
            if (b != null) blockSet.add(b);
        }
        int iterCount = blockSet.size();

        // Resolve Block.getBlockById(int). At runtime Forge keeps SRG method
        // names, so try MCP + SRG, then fall back to a signature scan (the only
        // public static Block(int) method) so we don't depend on a hard-coded
        // SRG string being correct.
        String idScanMethod = "unresolved";
        Method getBlockById = null;
        try {
            Class<?> blockClass = Class.forName("net.minecraft.block.Block");
            for (String n : new String[]{"getBlockById", "func_149729_e"}) {
                try { getBlockById = blockClass.getMethod(n, int.class); idScanMethod = n; break; }
                catch (NoSuchMethodException ignored) {}
            }
            if (getBlockById == null) {
                for (Method m : blockClass.getMethods()) {
                    if (java.lang.reflect.Modifier.isStatic(m.getModifiers())
                        && m.getReturnType() == blockClass
                        && m.getParameterCount() == 1
                        && m.getParameterTypes()[0] == int.class) {
                        getBlockById = m;
                        idScanMethod = m.getName() + " (by signature)";
                        break;
                    }
                }
            }
        } catch (Exception ignored) {}

        if (getBlockById != null) {
            Object air = null;
            try { air = getBlockById.invoke(null, 0); } catch (Exception ignored) {}
            // GTNH uses extended block IDs well above the vanilla 4096 ceiling.
            for (int id = 1; id <= 32767; id++) {
                try {
                    Object b = getBlockById.invoke(null, id);
                    if (b != null && b != air) blockSet.add(b);
                } catch (Exception ignored) {}
            }
        }
        int idScanAdded = blockSet.size() - iterCount;
        System.out.printf("[AtlasDumper] registry iterator=%d, id-scan method=%s, id-scan added=%d%n",
            iterCount, idScanMethod, idScanAdded);

        for (Object block : blockSet) {
            String regName = getRegistryName(blockReg, block);
            if (regName == null || regName.isEmpty()) {
                skippedNoName++;
                continue;
            }

            totalBlocks++;
            Map<String, Map<String, String>> metaMap = new LinkedHashMap<>();

            for (int meta = 0; meta < 16; meta++) {
                Map<String, String> sideMap = new LinkedHashMap<>();

                for (int side = 0; side < 6; side++) {
                    try {
                        Object icon = getIconMethod.invoke(block, side, meta);
                        if (icon == null) continue;
                        String iconName = (String) getIconNameMethod.invoke(icon);
                        if (iconName != null && !iconName.isEmpty()) {
                            sideMap.put(String.valueOf(side), iconName);
                        }
                    } catch (Exception e) {
                        errorCount++;
                        if (errorSamples.size() < 50) {
                            Throwable cause = (e.getCause() != null) ? e.getCause() : e;
                            errorSamples.add(regName + " m=" + meta + " s=" + side
                                + " → " + cause.getClass().getSimpleName()
                                + (cause.getMessage() != null ? ": " + cause.getMessage().split("\n")[0] : ""));
                        }
                    }
                }

                if (!sideMap.isEmpty()) {
                    metaMap.put(String.valueOf(meta), sideMap);
                }
            }

            if (!metaMap.isEmpty()) {
                blocksMap.put(regName, metaMap);
                resolvedBlocks++;
            } else {
                // Full list (not capped): these blocks are in the registry but
                // getIcon(side, meta) yielded nothing — the precise set Atlas
                // must resolve another way (render rules / legacy heuristics).
                noIconNames.add(regName);
            }
        }

        // Loaded mod list — lets Atlas diff a world's FML.ModList against the
        // dump and surface exactly which mods are absent (the usual cause of
        // "no mapping" blocks: the dump was built from a different pack build).
        List<String> modList = new ArrayList<>();
        try {
            for (ModContainer mc : Loader.instance().getActiveModList()) {
                modList.add(mc.getModId() + "@" + mc.getVersion());
            }
        } catch (Throwable t) {
            System.err.println("[AtlasDumper] Could not read mod list: " + t);
        }

        // ── Write output ──────────────────────────────────────────────────────
        File outDir = new File(gameDir, "config/atlas");
        if (!outDir.exists() && !outDir.mkdirs()) {
            System.err.println("[AtlasDumper] Could not create output directory: " + outDir);
            return;
        }
        File outFile = new File(outDir, "icon_dump.json");

        try (FileWriter w = new FileWriter(outFile)) {
            writeJson(w, blocksMap, totalBlocks, resolvedBlocks, skippedNoName,
                      errorCount, errorSamples, noIconNames, modList,
                      iterCount, idScanMethod, idScanAdded);
            System.out.printf(
                "[AtlasDumper] Done — %d/%d blocks (%d no-icon, %d unnamed), "
                + "%d mods, %d errors → %s%n",
                resolvedBlocks, totalBlocks, noIconNames.size(), skippedNoName,
                modList.size(), errorCount, outFile.getAbsolutePath());
        } catch (IOException e) {
            System.err.println("[AtlasDumper] Write failed: " + e.getMessage());
        }
    }

    /**
     * Get the "modid:name" registry string for a block.
     * Primary: GameRegistry.findUniqueIdentifierFor — a real Forge method name,
     * always available regardless of deobfuscation level.
     * Fallback: getNameForObject / func_148741_d on the registry superclass.
     */
    @SuppressWarnings("rawtypes")
    private String getRegistryName(FMLControlledNamespacedRegistry blockReg, Object block) {
        // Primary: GameRegistry.findUniqueIdentifierFor(Block block)
        // This is a Forge method with its real name; parameter type is Block at runtime.
        try {
            Class<?> baseBlockClass = block.getClass();
            while (baseBlockClass.getSuperclass() != null &&
                   !baseBlockClass.getName().equals("net.minecraft.block.Block")) {
                baseBlockClass = baseBlockClass.getSuperclass();
            }
            Method findUID = GameRegistry.class.getMethod("findUniqueIdentifierFor", baseBlockClass);
            Object uid = findUID.invoke(null, block);
            if (uid != null) {
                String modId = (String) uid.getClass().getField("modId").get(uid);
                String name  = (String) uid.getClass().getField("name").get(uid);
                return modId + ":" + name;
            }
        } catch (Exception ignored) {}

        // Fallback: getNameForObject / func_148741_d on the registry
        if (getNameMethod != null) {
            try {
                return (String) getNameMethod.invoke(blockReg, block);
            } catch (Exception ignored) {}
        }
        return null;
    }

    // ── Minimal hand-rolled JSON writer ──────────────────────────────────────

    private void writeJson(
        FileWriter w,
        Map<String, Map<String, Map<String, String>>> blocksMap,
        int total, int resolved, int skippedNoName, int errors,
        List<String> errorSamples, List<String> noIconNames, List<String> modList,
        int iterCount, String idScanMethod, int idScanAdded
    ) throws IOException {
        String ts = new SimpleDateFormat("yyyy-MM-dd HH:mm:ss").format(new Date());

        w.write("{\n");
        w.write("  \"format\": \"atlas-gtnh-icon-dump-v1\",\n");
        w.write("  \"minecraft_version\": \"1.7.10\",\n");
        w.write("  \"generated_at\": " + jsonStr(ts) + ",\n");
        w.write("  \"summary\": {\n");
        w.write("    \"total_blocks\": "         + total         + ",\n");
        w.write("    \"blocks_with_icons\": "    + resolved      + ",\n");
        w.write("    \"blocks_without_icons\": " + (total - resolved) + ",\n");
        w.write("    \"skipped_no_name\": "      + skippedNoName  + ",\n");
        w.write("    \"registry_iter_count\": " + iterCount      + ",\n");
        w.write("    \"id_scan_method\": "       + jsonStr(idScanMethod) + ",\n");
        w.write("    \"id_scan_added\": "        + idScanAdded    + ",\n");
        w.write("    \"mod_count\": "            + modList.size() + ",\n");
        w.write("    \"errors\": "               + errors        + ",\n");
        w.write("    \"error_samples\": [");
        for (int i = 0; i < errorSamples.size(); i++) {
            if (i > 0) w.write(", ");
            w.write(jsonStr(errorSamples.get(i)));
        }
        w.write("],\n");
        w.write("    \"no_icon_blocks\": [");
        for (int i = 0; i < noIconNames.size(); i++) {
            if (i > 0) w.write(", ");
            w.write(jsonStr(noIconNames.get(i)));
        }
        w.write("]\n  },\n");

        // Loaded mods (modid@version) — for world↔dump mismatch detection.
        w.write("  \"mods\": [");
        for (int i = 0; i < modList.size(); i++) {
            if (i > 0) w.write(", ");
            w.write(jsonStr(modList.get(i)));
        }
        w.write("],\n");

        w.write("  \"blocks\": {\n");
        int bi = 0;
        for (Map.Entry<String, Map<String, Map<String, String>>> blockEntry : blocksMap.entrySet()) {
            if (bi++ > 0) w.write(",\n");
            w.write("    " + jsonStr(blockEntry.getKey()) + ": {\n");
            int mi = 0;
            for (Map.Entry<String, Map<String, String>> metaEntry : blockEntry.getValue().entrySet()) {
                if (mi++ > 0) w.write(",\n");
                w.write("      " + jsonStr(metaEntry.getKey()) + ": {");
                int si = 0;
                for (Map.Entry<String, String> sideEntry : metaEntry.getValue().entrySet()) {
                    if (si++ > 0) w.write(", ");
                    w.write(jsonStr(sideEntry.getKey()) + ": " + jsonStr(sideEntry.getValue()));
                }
                w.write("}");
            }
            w.write("\n    }");
        }
        w.write("\n  }\n}\n");
    }

    private static String jsonStr(String s) {
        if (s == null) return "null";
        StringBuilder sb = new StringBuilder("\"");
        for (int i = 0; i < s.length(); i++) {
            char c = s.charAt(i);
            if      (c == '"')  sb.append("\\\"");
            else if (c == '\\') sb.append("\\\\");
            else if (c == '\n') sb.append("\\n");
            else if (c == '\r') sb.append("\\r");
            else if (c == '\t') sb.append("\\t");
            else                sb.append(c);
        }
        return sb.append('"').toString();
    }
}
