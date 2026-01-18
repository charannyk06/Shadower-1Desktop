
from PIL import Image
import numpy as np

def create_final_logo(input_path, output_path):
    print(f"Processing {input_path}...")
    try:
        # Load image
        img = Image.open(input_path).convert("RGBA")
        data = np.array(img)
        
        # Advanced Luminance Extraction (White -> Transparent, Black -> Black Opaque)
        r, g, b = data[:,:,0], data[:,:,1], data[:,:,2]
        
        # Use simple average for brightness/whiteness approximation
        brightness = (r.astype(int) + g.astype(int) + b.astype(int)) / 3
        
        # Alpha is inverse of brightness (White 255 -> Alpha 0, Black 0 -> Alpha 255)
        new_alpha = 255 - brightness
        
        # Set RGB to pure black to ensure no grey halos
        data[:,:,0] = 0
        data[:,:,1] = 0
        data[:,:,2] = 0
        data[:,:,3] = new_alpha
        
        result = Image.fromarray(data, "RGBA")
        
        # Trim
        bbox = result.getbbox()
        if bbox:
            result = result.crop(bbox)
            
        result.save(output_path, "PNG")
        print(f"Success: Saved {output_path}")
        
    except Exception as e:
        print(f"Error: {e}")

if __name__ == "__main__":
    # TARGETING THE LATEST UPLOADED FILE
    input_file = "/Users/charannsrinivas/.gemini/antigravity/brain/facfb508-f97e-40df-a490-ccb235bb7cd8/uploaded_image_1767979849226.jpg"
    # TARGETING A UNIQUE FINAL NAME
    output_file = "/Users/charannsrinivas/Documents/Shadower-1/public/shadower-logo-final.png"
    create_final_logo(input_file, output_file)
