
from PIL import Image, ImageOps
import numpy as np
import sys

def convert_white_to_transparent(input_path, output_path):
    print(f"Processing {input_path}...")
    try:
        # Load image
        img = Image.open(input_path).convert("RGBA")
        
        # Convert to numpy array
        data = np.array(img)
        
        # Calculate luminance (perceived brightness)
        # Standard formula: L = 0.299*R + 0.587*G + 0.114*B
        # But for simple white removal, taking the average or max channel works well for neutral colors
        r, g, b, a = data[:,:,0], data[:,:,1], data[:,:,2], data[:,:,3]
        
        # Improve: Use the brighest channel as the 'whiteness' measure to avoid color shifting if there are slight tints
        brightness = np.maximum(np.maximum(r, g), b)
        
        # Algorithm:
        # We assume the user wants to keep the "Darkness" of the image.
        # White (255) -> Transparent (Alpha 0)
        # Black (0) -> Opaque (Alpha 255)
        # Grey (128) -> Semi-transparent (Alpha ~128)
        
        # New Alpha = 255 - Brightness
        # We perform this calculation using optimized numpy operations
        new_alpha = 255 - brightness
        
        # However, we must ensure that the RGB values are set to pure Black (0,0,0) 
        # so that the semi-transparency works correctly as "Ink density"
        # If we keep original light-grey RGB with light-grey Alpha, it double-lightens.
        # We set RGB to 0,0,0 (Black).
        
        # Create a new array for the output
        new_data = np.zeros_like(data)
        new_data[:,:,0] = 0   # Red -> 0
        new_data[:,:,1] = 0   # Green -> 0
        new_data[:,:,2] = 0   # Blue -> 0
        new_data[:,:,3] = new_alpha # Alpha -> Based on darkness
        
        # Create image from new data
        result = Image.fromarray(new_data, "RGBA")
        
        # Crop empty space
        bbox = result.getbbox()
        if bbox:
            result = result.crop(bbox)
            
        result.save(output_path, "PNG")
        print(f"Saved cleanly extracted logo to {output_path}")
        
    except Exception as e:
        print(f"Error: {e}")

if __name__ == "__main__":
    input_file = "/Users/charannsrinivas/.gemini/antigravity/brain/facfb508-f97e-40df-a490-ccb235bb7cd8/uploaded_image_1767979211651.jpg"
    output_file = "/Users/charannsrinivas/Documents/Shadower-1/public/logo-v3.png"
    convert_white_to_transparent(input_file, output_file)
