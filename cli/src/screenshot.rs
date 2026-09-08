//! Screenshot capture and compression

use ab_glyph::{FontArc, PxScale};
use anyhow::{Context, Result};
use base64::{engine::general_purpose::STANDARD as BASE64, Engine as _};
use image::{DynamicImage, GenericImageView, Rgba, RgbaImage};
use imageproc::drawing::{draw_hollow_rect_mut, draw_text_mut};
use imageproc::rect::Rect;
use std::io::Cursor;

use crate::{android, harmony, ios};

/// Take screenshot with optional compression
pub fn take_screenshot(
    platform: &str,
    output: Option<&str>,
    compress: bool,
    max_width: u32,
    quality: u8,
    simulator: Option<&str>,
    device: Option<&str>,
) -> Result<()> {
    // Capture screenshot
    let png_data = if platform == "android" {
        android::screenshot(device)?
    } else {
        ios::screenshot(simulator)?
    };

    // Process image
    let final_data = if compress {
        compress_image(&png_data, max_width, quality)?
    } else {
        png_data
    };

    // Output
    if let Some(path) = output {
        std::fs::write(path, &final_data)?;
        eprintln!("Screenshot saved to: {} ({} bytes)", path, final_data.len());
    } else {
        // Output as base64 for LLM consumption
        let b64 = BASE64.encode(&final_data);
        println!("{}", b64);
        eprintln!(
            "Screenshot: {} bytes (base64: {} chars)",
            final_data.len(),
            b64.len()
        );
    }

    Ok(())
}

/// Compress image for LLM processing
fn compress_image(png_data: &[u8], max_width: u32, quality: u8) -> Result<Vec<u8>> {
    // Load image
    let img = image::load_from_memory(png_data)?;
    let (width, height) = img.dimensions();

    eprintln!("Original: {}x{} ({} bytes)", width, height, png_data.len());

    // Resize if needed
    let img = if width > max_width {
        let new_height = (height as f32 * max_width as f32 / width as f32) as u32;
        eprintln!("Resizing to: {}x{}", max_width, new_height);
        img.resize(max_width, new_height, image::imageops::FilterType::Lanczos3)
    } else {
        img
    };

    // Convert to JPEG for smaller size
    let mut jpeg_data = Vec::new();
    let mut cursor = Cursor::new(&mut jpeg_data);

    // Use JPEG encoder with quality setting
    let encoder = image::codecs::jpeg::JpegEncoder::new_with_quality(&mut cursor, quality);
    img.write_with_encoder(encoder)?;

    eprintln!(
        "Compressed: {} bytes ({}% of original)",
        jpeg_data.len(),
        jpeg_data.len() * 100 / png_data.len()
    );

    Ok(jpeg_data)
}

struct AnnotationElement {
    bounds: (i32, i32, i32, i32),
    clickable: bool,
    label: String,
}

/// Take annotated screenshot with UI element bounds drawn
pub fn take_annotated_screenshot(
    platform: &str,
    output: Option<&str>,
    device: Option<&str>,
    simulator: Option<&str>,
) -> Result<()> {
    // Get screenshot and the platform accessibility bounds.
    let png_data = match platform {
        "android" => android::screenshot(device)?,
        "harmony" => harmony::screenshot(device)?,
        _ => ios::screenshot(simulator)?,
    };
    let elements = match platform {
        "android" => android::get_ui_elements(device)?
            .into_iter()
            .map(|element| AnnotationElement {
                bounds: element.bounds,
                clickable: element.clickable,
                label: element.label(),
            })
            .collect::<Vec<_>>(),
        "harmony" => harmony::get_ui_elements(device)?
            .into_iter()
            .map(|element| AnnotationElement {
                bounds: element.bounds,
                clickable: element.clickable,
                label: element.label().to_owned(),
            })
            .collect::<Vec<_>>(),
        _ => {
            eprintln!("Note: Annotated screenshot element bounds are unavailable on iOS");
            Vec::new()
        }
    };

    // Load image
    let img = image::load_from_memory(&png_data)?;
    let mut rgba_img: RgbaImage = img.to_rgba8();

    // Colors for drawing
    let red = Rgba([255u8, 0u8, 0u8, 255u8]);
    let green = Rgba([0u8, 255u8, 0u8, 255u8]);

    // Load a basic font (embedded for portability)
    let font_data = include_bytes!("../assets/DejaVuSans.ttf");
    let font = FontArc::try_from_slice(font_data).context("Failed to load font")?;
    let scale = PxScale::from(24.0);

    // Draw elements
    for (i, elem) in elements.iter().enumerate() {
        let (x1, y1, x2, y2) = elem.bounds;

        // Skip very small or full-screen elements
        let width = x2 - x1;
        let height = y2 - y1;
        if width < 10 || height < 10 || (width > 1000 && height > 2000) {
            continue;
        }

        let color = if elem.clickable { green } else { red };

        // Draw rectangle
        if x1 >= 0 && y1 >= 0 && x2 > x1 && y2 > y1 {
            let rect = Rect::at(x1, y1).of_size((x2 - x1) as u32, (y2 - y1) as u32);
            draw_hollow_rect_mut(&mut rgba_img, rect, color);
        }

        // Draw number label
        let label = format!("{}", i + 1);
        draw_text_mut(
            &mut rgba_img,
            color,
            x1,
            y1.saturating_sub(20),
            scale,
            &font,
            &label,
        );
    }

    // Convert back to bytes
    let mut output_data = Vec::new();
    let mut cursor = Cursor::new(&mut output_data);
    rgba_img.write_to(&mut cursor, image::ImageFormat::Png)?;

    // Output
    if let Some(path) = output {
        std::fs::write(path, &output_data)?;
        eprintln!(
            "Annotated screenshot saved to: {} ({} bytes)",
            path,
            output_data.len()
        );
    } else {
        let b64 = BASE64.encode(&output_data);
        println!("{}", b64);
        eprintln!("Annotated screenshot: {} bytes", output_data.len());
    }

    // Print element index
    eprintln!("\nElements:");
    for (i, element) in elements.iter().enumerate() {
        let (x1, y1, x2, y2) = element.bounds;
        let center = ((x1 + x2) / 2, (y1 + y2) / 2);
        eprintln!(
            "  {}: {} @ ({}, {})",
            i + 1,
            element.label,
            center.0,
            center.1
        );
    }

    Ok(())
}

/// Analyze screenshot and return structured info (for future use)
#[allow(dead_code)]
pub fn analyze_screenshot(data: &[u8]) -> Result<ScreenshotInfo> {
    let img = image::load_from_memory(data)?;
    let (width, height) = img.dimensions();

    // Calculate average brightness
    let brightness = calculate_brightness(&img);

    // Detect if mostly text (high contrast)
    let is_text_heavy = brightness > 200.0 || brightness < 50.0;

    Ok(ScreenshotInfo {
        width,
        height,
        size_bytes: data.len(),
        brightness,
        is_text_heavy,
    })
}

#[allow(dead_code)]
fn calculate_brightness(img: &DynamicImage) -> f32 {
    let rgb = img.to_rgb8();
    let pixels = rgb.pixels();
    let mut total: u64 = 0;
    let mut count: u64 = 0;

    for pixel in pixels {
        // Luminance formula
        let r = pixel[0] as u64;
        let g = pixel[1] as u64;
        let b = pixel[2] as u64;
        total += (r * 299 + g * 587 + b * 114) / 1000;
        count += 1;
    }

    if count > 0 {
        total as f32 / count as f32
    } else {
        0.0
    }
}

#[derive(Debug)]
#[allow(dead_code)]
pub struct ScreenshotInfo {
    pub width: u32,
    pub height: u32,
    pub size_bytes: usize,
    pub brightness: f32,
    pub is_text_heavy: bool,
}
