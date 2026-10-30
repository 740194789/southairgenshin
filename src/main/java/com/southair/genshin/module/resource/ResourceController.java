package com.southair.genshin.module.resource;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.southair.genshin.common.BusinessException;
import com.southair.genshin.common.GameType;
import com.southair.genshin.common.R;
import com.southair.genshin.module.resource.dto.ResourceRequest;
import com.southair.genshin.module.resource.dto.ResourceVO;
import com.southair.genshin.security.UserContext;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import javax.validation.Valid;
import java.nio.charset.StandardCharsets;
import java.time.LocalDateTime;
import java.time.format.DateTimeFormatter;

@RestController
@RequestMapping("/api/resources")
public class ResourceController {

    private static final DateTimeFormatter FILE_TIME = DateTimeFormatter.ofPattern("yyyyMMdd-HHmmss");
    private static final MediaType TEXT_CSV = new MediaType("text", "csv", StandardCharsets.UTF_8);

    private final ResourceService resourceService;
    private final ObjectMapper objectMapper;

    public ResourceController(ResourceService resourceService, ObjectMapper objectMapper) {
        this.resourceService = resourceService;
        this.objectMapper = objectMapper;
    }

    @GetMapping
    public R<ResourceVO> get(@RequestParam(defaultValue = "genshin") String game) {
        return R.ok(resourceService.get(UserContext.require(), game));
    }

    @PutMapping
    public R<ResourceVO> update(@Valid @RequestBody ResourceRequest request,
                                @RequestParam(defaultValue = "genshin") String game) {
        return R.ok(resourceService.update(UserContext.require(), game, request));
    }

    /** 导出当前游戏的账号资源快照：format=csv（默认）或 json。 */
    @GetMapping("/export")
    public ResponseEntity<byte[]> export(@RequestParam(defaultValue = "genshin") String game,
                                         @RequestParam(defaultValue = "csv") String format) {
        ResourceVO resource = resourceService.get(UserContext.require(), game);
        boolean json = "json".equalsIgnoreCase(format);
        byte[] content;
        String extension;
        MediaType mediaType;
        if (json) {
            try {
                content = objectMapper.writerWithDefaultPrettyPrinter()
                        .writeValueAsBytes(toRequest(resource));
            } catch (Exception e) {
                throw new BusinessException(500, "导出失败：" + e.getMessage());
            }
            extension = "json";
            mediaType = new MediaType(MediaType.APPLICATION_JSON, StandardCharsets.UTF_8);
        } else {
            content = ResourceCsv.write(resource).getBytes(StandardCharsets.UTF_8);
            extension = "csv";
            mediaType = TEXT_CSV;
        }

        String filename = "southair-" + GameType.normalize(game) + "-resources-"
                + LocalDateTime.now().format(FILE_TIME) + "." + extension;
        return ResponseEntity.ok()
                .header(HttpHeaders.CONTENT_DISPOSITION, "attachment; filename=\"" + filename + "\"")
                .contentType(mediaType)
                .body(content);
    }

    /** 导入资源快照：只覆盖填写了数值的字段。 */
    @PostMapping("/import")
    public R<ResourceVO> importResource(@RequestBody String body,
                                       @RequestParam(defaultValue = "genshin") String game,
                                       @RequestParam(defaultValue = "csv") String format) {
        ResourceRequest request = "json".equalsIgnoreCase(format)
                ? parseJson(body)
                : ResourceCsv.parse(body);
        if (request.getPrimogems() == null && request.getMora() == null
                && request.getIntertwinedFates() == null && request.getAcquaintedFates() == null) {
            throw new BusinessException("没有可导入的资源数据，请先在模板中填写数值");
        }
        return R.ok(resourceService.update(UserContext.require(), game, request));
    }

    /** 导入模板：CSV 只有表头，JSON 字段为空，避免误把模板覆盖到真实数据。 */
    @GetMapping("/template")
    public ResponseEntity<byte[]> template(@RequestParam(defaultValue = "csv") String format) {
        boolean json = "json".equalsIgnoreCase(format);
        byte[] content = (json ? ResourceCsv.emptyJson() : ResourceCsv.header())
                .getBytes(StandardCharsets.UTF_8);
        return ResponseEntity.ok()
                .header(HttpHeaders.CONTENT_DISPOSITION,
                        "attachment; filename=\"southair-resources-template." + (json ? "json" : "csv") + "\"")
                .contentType(json ? new MediaType(MediaType.APPLICATION_JSON, StandardCharsets.UTF_8) : TEXT_CSV)
                .body(content);
    }

    private ResourceRequest toRequest(ResourceVO resource) {
        ResourceRequest request = new ResourceRequest();
        request.setPrimogems(resource.getPrimogems());
        request.setMora(resource.getMora());
        request.setIntertwinedFates(resource.getIntertwinedFates());
        request.setAcquaintedFates(resource.getAcquaintedFates());
        return request;
    }

    private ResourceRequest parseJson(String body) {
        if (body == null || body.trim().isEmpty()) {
            throw new BusinessException("导入内容为空");
        }
        try {
            return objectMapper.readValue(body, ResourceRequest.class);
        } catch (Exception e) {
            throw new BusinessException("资源 JSON 解析失败：" + e.getMessage());
        }
    }
}
