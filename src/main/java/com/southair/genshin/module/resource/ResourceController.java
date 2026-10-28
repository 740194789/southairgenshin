package com.southair.genshin.module.resource;

import com.southair.genshin.common.R;
import com.southair.genshin.module.resource.dto.ResourceRequest;
import com.southair.genshin.module.resource.dto.ResourceVO;
import com.southair.genshin.security.UserContext;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import javax.validation.Valid;

@RestController
@RequestMapping("/api/resources")
public class ResourceController {

    private final ResourceService resourceService;

    public ResourceController(ResourceService resourceService) {
        this.resourceService = resourceService;
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
}
